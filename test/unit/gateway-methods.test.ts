import { describe, it, expect, vi } from 'vitest'
import { buildGatewayMethods } from '../../src/gateway-methods.js'
import type { YemotService } from '../../src/service.js'

function mkService(stub: Partial<YemotService>): YemotService {
  return {
    state: vi.fn().mockReturnValue({
      listening: true, port: 4080, baseUrl: 'https://x', activeCallCount: 0,
      version: '0.1.0', bootstrapStatus: 'ok',
    }),
    list: vi.fn().mockReturnValue([]),
    endCall: vi.fn().mockReturnValue(false),
    ...stub,
  } as unknown as YemotService
}

describe('gateway methods', () => {
  it('status returns the service.state() payload', () => {
    const svc = mkService({})
    const m = buildGatewayMethods(svc)
    const r = m.status({})
    expect(r.listening).toBe(true)
    expect(r.port).toBe(4080)
    expect(r.version).toBe('0.1.0')
  })

  it('list returns the active calls', () => {
    const svc = mkService({
      list: vi.fn().mockReturnValue([
        { callId: 'A', phone: 'p', did: 'd', startedAt: 1, lastTurnAt: 2, transcriptLength: 3 },
      ]),
    })
    const r = buildGatewayMethods(svc).list({})
    expect(r).toHaveLength(1)
    expect(r[0]?.callId).toBe('A')
  })

  it('end returns ok=true when call existed', () => {
    const svc = mkService({ endCall: vi.fn().mockReturnValue(true) })
    const r = buildGatewayMethods(svc).end({ callId: 'X' })
    expect(r.ok).toBe(true)
  })

  it('end returns ok=false when call did not exist', () => {
    const svc = mkService({ endCall: vi.fn().mockReturnValue(false) })
    const r = buildGatewayMethods(svc).end({ callId: 'NOPE' })
    expect(r.ok).toBe(false)
  })

  it('end throws when callId is missing', () => {
    const svc = mkService({})
    expect(() => buildGatewayMethods(svc).end({} as { callId: string })).toThrow(/callId/i)
  })
})
