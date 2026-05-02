import type { CallSessionState, CallEndReason } from './types.js'

/**
 * Normalized call events. Vocabulary mirrors voice-call/extensions/voice-call/src/types.ts
 * NormalizedEvent.type — minus events that don't apply to Yemot (call.ringing,
 * call.answered are inferable from call.initiated).
 */

export type NormalizedEvent =
  | { type: 'call.initiated'; session: CallSessionState }
  | { type: 'call.speech'; session: CallSessionState; text: string; isFinal: true }
  | { type: 'call.dtmf'; session: CallSessionState; digits: string }
  | { type: 'call.silence'; session: CallSessionState; durationMs: number }
  | { type: 'call.speaking'; session: CallSessionState; text: string }
  | { type: 'call.error'; session: CallSessionState; error: Error; retryable: boolean }
  | { type: 'call.ended'; session: CallSessionState; reason: CallEndReason }
  | { type: 'extension.configured'; apiLink: string; extensionNumber: string }
  | { type: 'auth.failed'; remoteIp: string; reason: string }

export type NormalizedEventType = NormalizedEvent['type']
