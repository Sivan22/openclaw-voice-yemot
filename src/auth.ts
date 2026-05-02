import { timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction, RequestHandler } from 'express'

export interface AuthMiddlewareOptions {
  sharedSecret: string
  disableAuth: boolean
  onAuthFailure?: (info: { reason: string; remoteIp: string }) => void
}

export function createAuthMiddleware(opts: AuthMiddlewareOptions): RequestHandler {
  return function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (opts.disableAuth) {
      next()
      return
    }
    const provided = typeof req.query.secret === 'string' ? req.query.secret : ''
    if (constantTimeEquals(provided, opts.sharedSecret)) {
      next()
      return
    }
    opts.onAuthFailure?.({ reason: 'secret-mismatch', remoteIp: req.ip ?? '' })
    res.status(403).send('; auth-failed')
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  // Pad to equal length to keep this constant-time across length-diff attempts.
  const len = Math.max(a.length, b.length, 1)
  const ab = Buffer.alloc(len, 0)
  const bb = Buffer.alloc(len, 0)
  ab.write(a, 0, 'utf8')
  bb.write(b, 0, 'utf8')
  // timingSafeEqual requires equal length — we've ensured that above.
  return timingSafeEqual(ab, bb) && a.length === b.length
}
