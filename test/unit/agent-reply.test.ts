import { describe, it, expect } from 'vitest'
import { parseAgentReply, AgentReplyParseError } from '../../src/agent-reply.js'
import type { AgentReply } from '../../src/types.js'

describe('parseAgentReply', () => {
  it('auto-wraps plain text to stt mode, end=false', () => {
    const r = parseAgentReply('שלום!')
    expect(r).toEqual<AgentReply>({ spoken: 'שלום!', mode: 'stt', end: false })
  })

  it('parses strict JSON with all fields', () => {
    const json = JSON.stringify({
      spoken: 'בחר מספר',
      mode: 'tap',
      tap: { digits: ['1', '2', '3'], maxDigits: 1, timeoutSec: 5 },
      end: false,
    })
    expect(parseAgentReply(json)).toEqual<AgentReply>({
      spoken: 'בחר מספר',
      mode: 'tap',
      tap: { digits: ['1', '2', '3'], maxDigits: 1, timeoutSec: 5 },
      end: false,
    })
  })

  it('parses JSON with end:true', () => {
    expect(parseAgentReply('{"spoken":"להתראות","end":true}'))
      .toEqual<AgentReply>({ spoken: 'להתראות', mode: 'stt', end: true })
  })

  it('parses JSON with only spoken (defaults filled)', () => {
    expect(parseAgentReply('{"spoken":"שלום"}'))
      .toEqual<AgentReply>({ spoken: 'שלום', mode: 'stt', end: false })
  })

  it('falls through to auto-wrap when JSON is malformed and `strict=false`', () => {
    expect(parseAgentReply('{not valid json', { strict: false }))
      .toEqual<AgentReply>({ spoken: '{not valid json', mode: 'stt', end: false })
  })

  it('throws AgentReplyParseError for malformed JSON when strict=true', () => {
    expect(() => parseAgentReply('{not valid json', { strict: true }))
      .toThrow(AgentReplyParseError)
  })

  it('throws AgentReplyParseError when JSON object missing `spoken`', () => {
    expect(() => parseAgentReply('{"mode":"stt"}', { strict: true }))
      .toThrow(AgentReplyParseError)
  })

  it('throws when mode=tap but tap field absent', () => {
    expect(() => parseAgentReply('{"spoken":"x","mode":"tap"}', { strict: true }))
      .toThrow(AgentReplyParseError)
  })

  it('rejects extra unknown fields silently when strict=false (forgiving)', () => {
    const r = parseAgentReply('{"spoken":"hi","weird":42}', { strict: false })
    expect(r.spoken).toBe('hi')
    expect((r as unknown as { weird?: number }).weird).toBeUndefined()
  })

  it('coerces empty/whitespace-only strings to {spoken:"", mode:stt, end:false}', () => {
    expect(parseAgentReply('   '))
      .toEqual<AgentReply>({ spoken: '   ', mode: 'stt', end: false })
  })
})
