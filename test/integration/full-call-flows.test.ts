import { describe, it, expect, afterEach } from 'vitest'
import { YemotService } from '../../src/service.js'
import { stubAgent } from '../helpers/stub-agent.js'
import { MockYemotCaller } from '../helpers/mock-yemot.js'
import type { PluginConfig } from '../../src/types.js'
import type { NormalizedEvent } from '../../src/events.js'
import type { AgentRunner, AgentRunInput } from '../../src/agent-loop.js'

/**
 * Build an agent runner that dispatches to a per-conversation reply queue
 * (keyed by AgentRunInput.conversationId — which is the callId). This is
 * needed for concurrent-calls tests where a flat shared queue would
 * race-interleave replies between sessions.
 */
function perCallStubAgent(scripts: Record<string, string[]>): AgentRunner {
  const queues = new Map<string, string[]>()
  for (const [k, v] of Object.entries(scripts)) queues.set(k, [...v])
  return async (input: AgentRunInput): Promise<string> => {
    const q = queues.get(input.conversationId)
    if (!q || q.length === 0) {
      throw new Error(`perCallStubAgent: no replies for conversation ${input.conversationId}`)
    }
    return q.shift()!
  }
}

function baseCfg(): PluginConfig {
  return {
    yemot: {
      systemNumber: '0772345678', username: 'u', password: 'p',
      extensionNumber: '1', extensionTitle: 'Test',
      apiBaseUrl: 'https://example.invalid/ym/api/',
      language: 'he-IL', removeInvalidTtsChars: true,
      autoConfigureExtension: false,
    },
    server: {
      port: 0, host: '127.0.0.1', webhookPath: '/yemot',
      publicBaseUrl: '',                       // filled in after start
      sharedSecret: 'sssssssssssssssss',
      disableAuth: false,
    },
    agent: { name: 'bot', systemPromptAddon: '', responseTimeoutMs: 5000, maxTurnsPerCall: 50 },
    call: { defaultMode: 'stt', sttQuietMaxSec: 3, sttMaxLengthSec: 30, callIdleTimeoutSec: 60, fallbackErrorMessage: 'שגיאה' },
    persistence: { transcripts: false, logDir: './var' },
  }
}

interface Spawned {
  svc: YemotService
  caller: (callId: string) => MockYemotCaller
  events: NormalizedEvent[]
  endpoint: string
}

async function spawn(
  cfgOverrides: Partial<PluginConfig> = {},
  runnerOrReplies: string[] | AgentRunner = [],
): Promise<Spawned> {
  const events: NormalizedEvent[] = []
  const cfg = { ...baseCfg(), ...cfgOverrides }
  const runner: AgentRunner = typeof runnerOrReplies === 'function'
    ? runnerOrReplies
    : stubAgent(...runnerOrReplies)
  const svc = new YemotService({
    cfg,
    runner,
    onEvent: e => events.push(e),
  })
  await svc.start()
  const port = svc.state().port
  const endpoint = `http://127.0.0.1:${port}/yemot`
  const caller = (callId: string) => new MockYemotCaller(endpoint, {
    ApiCallId: callId, ApiPhone: '0521234567', ApiDID: '0772345678', ApiRealDID: '0772345678',
    ApiExtension: '1', ApiTime: String(Math.floor(Date.now() / 1000)), ApiYFCallId: callId,
  }, cfg.server.sharedSecret)
  return { svc, caller, events, endpoint }
}

describe('full-call flows', () => {
  let spawned: Spawned | undefined
  afterEach(async () => { await spawned?.svc.stop(); spawned = undefined })

  it('greets, takes one user turn, ends the call', async () => {
    spawned = await spawn({}, ['שלום!', '{"spoken":"להתראות","end":true}'])
    const log = await spawned.caller('YF-1').simulateCall([
      { input: { val_1: 'אני רוצה תור' } },
    ])
    expect(log[0]?.response).toMatch(/^read=t-/)
    expect(log[0]?.response).toContain('שלום!')
    expect(log[1]?.response).toMatch(/^id_list_message=t-/)
    expect(log[1]?.response).toContain('להתראות')
  })

  it('multi-turn (5 turns) all stt mode', async () => {
    spawned = await spawn({}, [
      'שלום, איך אפשר לעזור?',
      'מה השם שלך?',
      'נעים מאוד',
      'איפה אתה גר?',
      'תודה רבה',
      '{"spoken":"להתראות","end":true}',
    ])
    const log = await spawned.caller('YF-2').simulateCall([
      { input: { val_1: 'בוקר טוב' } },
      { input: { val_2: 'יוסי' } },
      { input: { val_3: 'בסדר' } },
      { input: { val_4: 'תל אביב' } },
      { input: { val_5: 'בבקשה' } },
    ])
    expect(log).toHaveLength(6)            // 5 reads + 1 id_list_message
    expect(log[5]?.response).toMatch(/^id_list_message=t-/)
  })

  it('mid-call switch from stt to tap', async () => {
    spawned = await spawn({}, [
      'שלום',
      '{"spoken":"בחר 1, 2, או 3","mode":"tap","tap":{"digits":["1","2","3"],"maxDigits":1,"timeoutSec":5}}',
      '{"spoken":"בחירתך התקבלה","end":true}',
    ])
    const log = await spawned.caller('YF-3').simulateCall([
      { input: { val_1: 'מה האפשרויות?' } },
      { input: { val_2: '2' } },
    ])
    // Second prompt should be a tap-mode read
    const r2 = log[1]?.response ?? ''
    // tap mode in yemot-router2 yields a read directive without ",voice," — its third slot is digit count
    expect(r2).toMatch(/^read=/)
    expect(r2).not.toContain(',voice,')
    const dtmf = spawned.events.find(e => e.type === 'call.dtmf')
    expect(dtmf).toBeDefined()
  })

  it('caller hangs up mid-conversation', async () => {
    spawned = await spawn({}, ['שלום!', 'מה?', 'מה?'])
    await spawned.caller('YF-4').simulateCall([
      { input: { val_1: 'אהמ' } },
      { hangup: true },
    ])
    const ended = spawned.events.find(e => e.type === 'call.ended')
    expect(ended).toBeDefined()
  })

  it('two consecutive empty inputs: addin handles gracefully without crashing', async () => {
    // Upstream constraint: yemot-router2 6.2.0 internally auto-retries when the
    // value bound to the read's valName is empty (response-functions-level
    // recursion in `Call.read`). The addin's `consecutiveEmptyInputs >= 2 →
    // idle-timeout` branch in router-bridge.ts is therefore unreachable through
    // the wire layer in stt mode — empty STT values never surface to the addin
    // because the router re-prompts before returning. We test the OBSERVABLE
    // behavior here: empty inputs cause the router to re-issue the same `read`
    // directive (with an incremented val_n), the call eventually ends cleanly
    // when the caller hangs up, and no error event is emitted.
    spawned = await spawn({}, ['שלום!', 'נסה שוב', 'נסה שוב'])
    const log = await spawned.caller('YF-5').simulateCall([
      { input: { val_1: '' } },
      { input: { val_2: '' } },
      { hangup: true },
    ])
    // Each non-final response should be a `read=` re-prompt (the router's
    // auto-retry on empty val).
    expect(log[0]?.response).toMatch(/^read=/)
    expect(log[1]?.response).toMatch(/^read=/)
    expect(log[2]?.response).toMatch(/^read=/)
    // Sanity: the val_n index should advance with each empty input.
    expect(log[1]?.response).toContain('val_2')
    expect(log[2]?.response).toContain('val_3')
    // Call ends cleanly on hangup (not as an error).
    const ended = spawned.events.find(e => e.type === 'call.ended')
    expect(ended).toBeDefined()
    if (ended?.type === 'call.ended') {
      expect(ended.reason).toBe('hangup-user')
    }
    expect(spawned.events.find(e => e.type === 'call.error')).toBeUndefined()
  })

  it('agent throws → fallback message played, reason=error', async () => {
    const events: NormalizedEvent[] = []
    const svc = new YemotService({
      cfg: baseCfg(),
      runner: async () => { throw new Error('boom') },
      onEvent: e => events.push(e),
    })
    await svc.start()
    const caller = new MockYemotCaller(
      `http://127.0.0.1:${svc.state().port}/yemot`,
      { ApiCallId: 'YF-6', ApiPhone:'p', ApiDID:'d', ApiRealDID:'d', ApiExtension:'1', ApiTime:'0', ApiYFCallId:'YF-6' },
      baseCfg().server.sharedSecret,
    )
    const log = await caller.simulateCall([{ hangup: true }])
    expect(log[0]?.response).toMatch(/^id_list_message=t-/)
    expect(log[0]?.response).toContain('שגיאה')
    const ended = events.find(e => e.type === 'call.ended')
    if (ended?.type === 'call.ended') {
      expect(ended.reason).toBe('error')
    }
    await svc.stop()
  })

  it('agent times out → fallback played', async () => {
    const cfg = baseCfg()
    cfg.agent.responseTimeoutMs = 50
    const svc = new YemotService({
      cfg,
      runner: () => new Promise(() => { /* hang forever */ }),
    })
    await svc.start()
    const caller = new MockYemotCaller(
      `http://127.0.0.1:${svc.state().port}/yemot`,
      { ApiCallId: 'YF-7', ApiPhone:'p', ApiDID:'d', ApiRealDID:'d', ApiExtension:'1', ApiTime:'0', ApiYFCallId:'YF-7' },
      cfg.server.sharedSecret,
    )
    const log = await caller.simulateCall([{ hangup: true }])
    expect(log[0]?.response).toContain('שגיאה')
    await svc.stop()
  })

  it('agent malformed JSON twice → auto-wrap as plain text', async () => {
    spawned = await spawn({}, [
      '{not valid',           // 1st: malformed
      '{still bad',           // 2nd: corrective retry also malformed
      '{"spoken":"ok bye","end":true}',
    ])
    const log = await spawned.caller('YF-8').simulateCall([
      { input: { val_1: 'hi' } },
    ])
    // First prompt is the auto-wrapped plain-text "{still bad" (after the corrective retry)
    expect(log[0]?.response).toContain('{still bad')
    expect(log[1]?.response).toMatch(/^id_list_message/)
  })

  it('wrong secret → 403, no session created', async () => {
    spawned = await spawn({}, ['שלום!'])
    const res = await fetch(spawned.endpoint + '?secret=wrong', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ApiCallId: 'YF-9', ApiPhone:'p', ApiDID:'d', ApiRealDID:'d', ApiExtension:'1', ApiTime:'0', ApiYFCallId:'YF-9',
      }).toString(),
    })
    expect(res.status).toBe(403)
    expect(spawned.events.find(e => e.type === 'call.initiated')).toBeUndefined()
    expect(spawned.events.find(e => e.type === 'auth.failed')).toBeDefined()
  })

  it('three concurrent calls — sessions isolated', async () => {
    // Use a per-callId runner so concurrent calls don't race-interleave on a
    // shared reply queue. Each call gets its own deterministic script.
    spawned = await spawn({}, perCallStubAgent({
      'YF-A': ['שלום A', '{"spoken":"bye A","end":true}'],
      'YF-B': ['שלום B', '{"spoken":"bye B","end":true}'],
      'YF-C': ['שלום C', '{"spoken":"bye C","end":true}'],
    }))
    const [logA, logB, logC] = await Promise.all([
      spawned.caller('YF-A').simulateCall([{ input: { val_1: 'a-said' } }]),
      spawned.caller('YF-B').simulateCall([{ input: { val_1: 'b-said' } }]),
      spawned.caller('YF-C').simulateCall([{ input: { val_1: 'c-said' } }]),
    ])
    // Each call's final id_list_message reflects the right reply.
    // logX[1]?.response is the response to the user-input POST (i.e. the
    // id_list_message with the bye text).
    expect(logA[1]?.response).toContain('bye A')
    expect(logB[1]?.response).toContain('bye B')
    expect(logC[1]?.response).toContain('bye C')
    // No transcript bleed: the three sessions ended cleanly
    expect(spawned.events.filter(e => e.type === 'call.ended')).toHaveLength(3)
  })
})
