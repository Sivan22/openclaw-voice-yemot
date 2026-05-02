import type { YemotService, ServiceState } from './service.js'

export interface GatewayMethods {
  status(args: Record<string, never>): ServiceState
  list(args: Record<string, never>): Array<{ callId: string; phone: string; did: string; startedAt: number; lastTurnAt: number; transcriptLength: number }>
  end(args: { callId: string }): { ok: boolean }
}

export function buildGatewayMethods(svc: YemotService): GatewayMethods {
  return {
    status(_args) { return svc.state() },
    list(_args)   { return svc.list() },
    end(args) {
      if (typeof args?.callId !== 'string' || args.callId.length === 0) {
        throw new Error('voiceyemot.end: callId is required')
      }
      return { ok: svc.endCall(args.callId) }
    },
  }
}
