import { describe, it, expect, vi } from 'vitest'
import { AgentLoop, type AgentRunner, type AgentRunInput } from '../../src/agent-loop.js'
import { CallSession } from '../../src/call-session.js'

const cfg = {
  agentName: 'test-bot',
  systemPromptAddon: 'אתה בוט.',
  responseTimeoutMs: 1000,
  fallbackErrorMessage: 'שגיאה',
}

function mkSession() {
  return new CallSession({
    callId: 'YF-X', phone: '0521', did: '0772', realDid: '0772', extension: '1', language: 'he-IL',
  })
}

describe('AgentLoop.firstTurn', () => {
  it('calls agent runner with agentName, input=__call_started__, context, and returns parsed reply', async () => {
    const runner: AgentRunner = vi.fn().mockResolvedValue('שלום!')
    const loop = new AgentLoop({ runner, cfg })
    const r = await loop.firstTurn(mkSession())
    expect(r).toEqual({ spoken: 'שלום!', mode: 'stt', end: false })
    const arg = (runner as unknown as { mock: { calls: AgentRunInput[][] } }).mock.calls[0][0]
    expect(arg.agentName).toBe('test-bot')
    expect(arg.input).toBe('__call_started__')
    expect(arg.context.channel).toBe('voice-yemot')
    expect(arg.context.callId).toBe('YF-X')
    expect(arg.conversationId).toBe('YF-X')
    expect(arg.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('AgentLoop.nextTurn', () => {
  it('forwards user input', async () => {
    const runner: AgentRunner = vi.fn().mockResolvedValue('בסדר')
    const loop = new AgentLoop({ runner, cfg })
    await loop.nextTurn(mkSession(), 'אני רוצה תור')
    const arg = (runner as unknown as { mock: { calls: AgentRunInput[][] } }).mock.calls[0][0]
    expect(arg.input).toBe('אני רוצה תור')
  })

  it('parses JSON reply with end:true', async () => {
    const runner: AgentRunner = vi.fn().mockResolvedValue('{"spoken":"להתראות","end":true}')
    const loop = new AgentLoop({ runner, cfg })
    const r = await loop.nextTurn(mkSession(), 'תודה')
    expect(r).toEqual({ spoken: 'להתראות', mode: 'stt', end: true })
  })

  it('on timeout, throws AgentTimeoutError', async () => {
    const runner: AgentRunner = () => new Promise(() => { /* hang */ })
    const loop = new AgentLoop({ runner, cfg: { ...cfg, responseTimeoutMs: 50 } })
    await expect(loop.nextTurn(mkSession(), 'x')).rejects.toThrow(/timed out/i)
  })

  it('retries once with corrective prompt when JSON is malformed but starts with {', async () => {
    let n = 0
    const runner: AgentRunner = vi.fn().mockImplementation(async (input: AgentRunInput) => {
      n++
      if (n === 1) return '{not valid'
      // Second call should include the corrective prefix
      expect(input.input).toMatch(/Reply with strict JSON/)
      return '{"spoken":"בסדר","mode":"stt","end":false}'
    })
    const loop = new AgentLoop({ runner, cfg })
    const r = await loop.nextTurn(mkSession(), 'תודה')
    expect(r.spoken).toBe('בסדר')
    expect(n).toBe(2)
  })

  it('after 2 JSON failures, auto-wraps as plain text', async () => {
    let n = 0
    const runner: AgentRunner = vi.fn().mockImplementation(async () => {
      n++
      return '{still bad'
    })
    const loop = new AgentLoop({ runner, cfg })
    const r = await loop.nextTurn(mkSession(), 'x')
    expect(r.spoken).toBe('{still bad')
    expect(r.mode).toBe('stt')
    expect(n).toBe(2)
  })

  it('coerces empty/whitespace agent reply to fallbackErrorMessage', async () => {
    const runner: AgentRunner = vi.fn().mockResolvedValue('   ')
    const loop = new AgentLoop({ runner, cfg })
    const r = await loop.nextTurn(mkSession(), 'x')
    expect(r.spoken).toBe('שגיאה')
  })

  it('forwards AbortSignal from session; aborting the session causes the runner to receive an aborted signal', async () => {
    let receivedSignal: AbortSignal | undefined
    const runner: AgentRunner = vi.fn().mockImplementation(async (input: AgentRunInput) => {
      receivedSignal = input.signal
      return new Promise(resolve => {
        const t = setTimeout(() => resolve('שלום'), 1000)
        input.signal?.addEventListener('abort', () => { clearTimeout(t); resolve('aborted-default') })
      })
    })
    const loop = new AgentLoop({ runner, cfg: { ...cfg, responseTimeoutMs: 5000 } })
    const session = mkSession()
    const promise = loop.nextTurn(session, 'x')
    setTimeout(() => session.abort('hangup-user'), 10)
    const r = await promise
    expect(receivedSignal?.aborted).toBe(true)
    expect(r.spoken).toBe('aborted-default')
  })
})
