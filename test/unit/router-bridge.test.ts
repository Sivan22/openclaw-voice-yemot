import { describe, it, expect, vi } from 'vitest'
import { buildCallHandler } from '../../src/router-bridge.js'
import { SessionRegistry } from '../../src/call-session.js'
import { AgentLoop } from '../../src/agent-loop.js'
import { stubAgent } from '../helpers/stub-agent.js'
import type { NormalizedEvent } from '../../src/events.js'

interface FakeCallInit {
  ApiCallId: string
  inputs: string[]                      // each await call.read returns the next entry
  hangupAfter?: number                  // 0 = before turn 0; 1 = after turn 0; etc.
}

class ExitError extends Error {
  constructor() { super('Exit'); this.name = 'ExitError' }
}

function fakeCall(init: FakeCallInit): {
  call: any                              // the fake Call object passed to the handler
  events: { read: number; idList: number; hangup: number }
  responses: { directive: string; mode: string }[]
} {
  const events = { read: 0, idList: 0, hangup: 0 }
  const responses: { directive: string; mode: string }[] = []
  let inputIdx = 0
  let exited = false
  const call = {
    ApiCallId: init.ApiCallId,
    callId: init.ApiCallId,
    phone: '0521234567',
    did: '0772345678',
    real_did: '0772345678',
    extension: '1',
    ApiPhone: '0521234567',
    ApiDID: '0772345678',
    ApiRealDID: '0772345678',
    ApiExtension: '1',

    async read(messages: { type: string; data: string }[], mode: string, _opts?: unknown): Promise<string> {
      events.read++
      responses.push({ directive: messages.map(m => m.data).join('|'), mode })
      if (init.hangupAfter !== undefined && events.read > init.hangupAfter) {
        // Simulate caller hangup mid-read by throwing a tagged error;
        // the handler treats it as a normal exit.
        exited = true
        throw new ExitError()
      }
      const input = init.inputs[inputIdx++]
      if (input === undefined) {
        throw new Error('FakeCall: out of inputs')
      }
      return input
    },

    id_list_message(messages: { type: string; data: string }[], _opts?: unknown): never {
      events.idList++
      responses.push({ directive: messages.map(m => m.data).join('|'), mode: 'id_list' })
      exited = true
      throw new ExitError()
    },

    hangup(): never {
      events.hangup++
      throw new ExitError()
    },
  }
  return { call, events, responses }
}

const baseCfg = {
  agentName: 'test-bot',
  systemPromptAddon: 'אתה בוט.',
  responseTimeoutMs: 1000,
  fallbackErrorMessage: 'שגיאה',
}

describe('buildCallHandler', () => {
  it('runs the greet→listen→reply→end flow and emits events', async () => {
    const events: NormalizedEvent[] = []
    const registry = new SessionRegistry()
    const agentLoop = new AgentLoop({
      runner: stubAgent('שלום!', '{"spoken":"להתראות","end":true}'),
      cfg: baseCfg,
    })
    const handler = buildCallHandler({
      registry,
      agentLoop,
      cfg: { defaultMode: 'stt', sttQuietMaxSec: 3, sttMaxLengthSec: 30, language: 'he-IL', removeInvalidTtsChars: true, fallbackErrorMessage: 'שגיאה', maxTurnsPerCall: 50 },
      emit: e => events.push(e),
    })

    const { call, events: callEvents, responses } = fakeCall({
      ApiCallId: 'YF-1', inputs: ['אני רוצה תור'],
    })

    await handler(call as any).catch(e => {
      if (e?.name !== 'ExitError') throw e
    })

    // Two prompts emitted: greeting then goodbye
    expect(callEvents.read).toBe(1)
    expect(callEvents.idList).toBe(1)
    expect(responses[0]?.directive).toBe('שלום!')
    expect(responses[1]?.directive).toBe('להתראות')

    const types = events.map(e => e.type)
    expect(types).toContain('call.initiated')
    expect(types).toContain('call.speaking')
    expect(types).toContain('call.speech')
    expect(types).toContain('call.ended')

    expect(registry.size()).toBe(0)
  })

  it('on caller hangup, emits call.ended with reason hangup-user', async () => {
    const events: NormalizedEvent[] = []
    const registry = new SessionRegistry()
    const agentLoop = new AgentLoop({
      runner: stubAgent('שלום!'),
      cfg: baseCfg,
    })
    const handler = buildCallHandler({
      registry, agentLoop,
      cfg: { defaultMode: 'stt', sttQuietMaxSec: 3, sttMaxLengthSec: 30, language: 'he-IL', removeInvalidTtsChars: true, fallbackErrorMessage: 'שגיאה', maxTurnsPerCall: 50 },
      emit: e => events.push(e),
    })

    const { call } = fakeCall({ ApiCallId: 'YF-2', inputs: [], hangupAfter: 1 })

    await handler(call as any).catch(e => {
      if (e?.name !== 'ExitError') throw e
    })

    const ended = events.find(e => e.type === 'call.ended')
    expect(ended).toBeDefined()
    if (ended?.type === 'call.ended') {
      expect(ended.reason).toBe('hangup-user')
    }
  })

  it('on agent error, plays fallback and ends with reason error', async () => {
    const events: NormalizedEvent[] = []
    const registry = new SessionRegistry()
    const failingRunner = vi.fn().mockRejectedValue(new Error('boom'))
    const agentLoop = new AgentLoop({ runner: failingRunner, cfg: baseCfg })
    const handler = buildCallHandler({
      registry, agentLoop,
      cfg: { defaultMode: 'stt', sttQuietMaxSec: 3, sttMaxLengthSec: 30, language: 'he-IL', removeInvalidTtsChars: true, fallbackErrorMessage: 'שגיאה', maxTurnsPerCall: 50 },
      emit: e => events.push(e),
    })

    const { call, responses } = fakeCall({ ApiCallId: 'YF-3', inputs: [] })
    await handler(call as any).catch(e => {
      if (e?.name !== 'ExitError') throw e
    })

    expect(responses.find(r => r.mode === 'id_list')?.directive).toBe('שגיאה')
    const ended = events.find(e => e.type === 'call.ended')
    if (ended?.type === 'call.ended') {
      expect(ended.reason).toBe('error')
    }
  })

  it('switches mode to tap when agent reply has mode:tap', async () => {
    const events: NormalizedEvent[] = []
    const registry = new SessionRegistry()
    const agentLoop = new AgentLoop({
      runner: stubAgent(
        '{"spoken":"בחר","mode":"tap","tap":{"digits":["1","2"],"maxDigits":1,"timeoutSec":5}}',
        '{"spoken":"תודה","end":true}',
      ),
      cfg: baseCfg,
    })
    const handler = buildCallHandler({
      registry, agentLoop,
      cfg: { defaultMode: 'stt', sttQuietMaxSec: 3, sttMaxLengthSec: 30, language: 'he-IL', removeInvalidTtsChars: true, fallbackErrorMessage: 'שגיאה', maxTurnsPerCall: 50 },
      emit: e => events.push(e),
    })
    const { call, responses } = fakeCall({ ApiCallId: 'YF-4', inputs: ['1'] })
    await handler(call as any).catch(e => {
      if (e?.name !== 'ExitError') throw e
    })
    expect(responses[0]?.mode).toBe('tap')
    const dtmf = events.find(e => e.type === 'call.dtmf')
    expect(dtmf).toBeDefined()
  })

  it('terminates with max-turns when agent never sets end:true', async () => {
    const events: NormalizedEvent[] = []
    const registry = new SessionRegistry()
    // 100 non-ending replies — agent loop will be invoked too many times, max-turns kicks in
    const agentLoop = new AgentLoop({
      runner: stubAgent(...new Array(100).fill('keep going')),
      cfg: baseCfg,
    })
    const handler = buildCallHandler({
      registry, agentLoop,
      cfg: { defaultMode: 'stt', sttQuietMaxSec: 3, sttMaxLengthSec: 30, language: 'he-IL', removeInvalidTtsChars: true, fallbackErrorMessage: 'שגיאה', maxTurnsPerCall: 3 },
      emit: e => events.push(e),
    })
    const { call } = fakeCall({ ApiCallId: 'YF-5', inputs: new Array(50).fill('still talking') })
    await handler(call as any).catch(e => {
      if (e?.name !== 'ExitError') throw e
    })
    const ended = events.find(e => e.type === 'call.ended')
    if (ended?.type === 'call.ended') {
      expect(ended.reason).toBe('max-turns')
    }
  })

  it('counts consecutive empty inputs and ends after 2 with idle-timeout', async () => {
    const events: NormalizedEvent[] = []
    const registry = new SessionRegistry()
    const agentLoop = new AgentLoop({
      runner: stubAgent('שלום!', 'נסה שוב', 'נסה שוב'),
      cfg: baseCfg,
    })
    const handler = buildCallHandler({
      registry, agentLoop,
      cfg: { defaultMode: 'stt', sttQuietMaxSec: 3, sttMaxLengthSec: 30, language: 'he-IL', removeInvalidTtsChars: true, fallbackErrorMessage: 'שגיאה', maxTurnsPerCall: 50 },
      emit: e => events.push(e),
    })
    const { call } = fakeCall({ ApiCallId: 'YF-6', inputs: ['', ''] })
    await handler(call as any).catch(e => {
      if (e?.name !== 'ExitError') throw e
    })
    const ended = events.find(e => e.type === 'call.ended')
    if (ended?.type === 'call.ended') {
      expect(ended.reason).toBe('idle-timeout')
    }
  })
})
