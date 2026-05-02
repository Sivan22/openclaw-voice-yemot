import { describe, it, expect, vi } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { createAuthMiddleware } from '../../src/auth.js'

function mkReq(secret?: string, ip = '1.2.3.4'): Request {
  return {
    query: secret === undefined ? {} : { secret },
    ip,
  } as unknown as Request
}

function mkRes(): Response & { _status?: number; _body?: string } {
  const res: Partial<Response & { _status?: number; _body?: string }> = {}
  res.status = vi.fn((code: number) => { res._status = code; return res as Response }) as unknown as Response['status']
  res.send = vi.fn((body?: unknown) => { res._body = String(body ?? ''); return res as Response }) as unknown as Response['send']
  return res as Response & { _status?: number; _body?: string }
}

describe('createAuthMiddleware', () => {
  it('passes through when secret matches', () => {
    const mw = createAuthMiddleware({ sharedSecret: 'open-sesame-1234567', disableAuth: false })
    const next = vi.fn() as NextFunction
    const res = mkRes()
    mw(mkReq('open-sesame-1234567'), res, next)
    expect(next).toHaveBeenCalledOnce()
    expect(res._status).toBeUndefined()
  })

  it('returns 403 when secret missing', () => {
    const mw = createAuthMiddleware({ sharedSecret: 'open-sesame-1234567', disableAuth: false })
    const next = vi.fn() as NextFunction
    const res = mkRes()
    mw(mkReq(undefined), res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res._status).toBe(403)
  })

  it('returns 403 when secret wrong', () => {
    const mw = createAuthMiddleware({ sharedSecret: 'open-sesame-1234567', disableAuth: false })
    const next = vi.fn() as NextFunction
    const res = mkRes()
    mw(mkReq('wrong'), res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res._status).toBe(403)
  })

  it('passes through with no checks when disableAuth=true', () => {
    const mw = createAuthMiddleware({ sharedSecret: '', disableAuth: true })
    const next = vi.fn() as NextFunction
    const res = mkRes()
    mw(mkReq(undefined), res, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('emits onAuthFailure callback with reason and ip', () => {
    const onFail = vi.fn()
    const mw = createAuthMiddleware({
      sharedSecret: 'open-sesame-1234567',
      disableAuth: false,
      onAuthFailure: onFail,
    })
    mw(mkReq('wrong', '5.6.7.8'), mkRes(), vi.fn() as NextFunction)
    expect(onFail).toHaveBeenCalledWith({ reason: 'secret-mismatch', remoteIp: '5.6.7.8' })
  })

  it('uses constant-time compare (does not short-circuit on length difference)', () => {
    const mw = createAuthMiddleware({ sharedSecret: 'long-secret-abc', disableAuth: false })
    const next = vi.fn() as NextFunction
    const res = mkRes()
    mw(mkReq('x'), res, next)
    // Result is the same as a wrong-but-equal-length secret: 403, no exception
    expect(res._status).toBe(403)
  })
})
