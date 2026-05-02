import type { CallSessionState, TranscriptEntry } from './types.js'

export interface CallSessionInit {
  callId: string
  phone: string
  did: string
  realDid: string
  extension: string
  language: string
}

export class CallSession {
  readonly state: CallSessionState

  constructor(init: CallSessionInit) {
    const now = Date.now()
    this.state = {
      callId: init.callId,
      phone: init.phone,
      did: init.did,
      realDid: init.realDid,
      extension: init.extension,
      language: init.language,
      startedAt: now,
      lastTurnAt: now,
      transcript: [],
      turnCount: 0,
      abortController: new AbortController(),
      consecutiveEmptyInputs: 0,
    }
  }

  appendTranscript(entry: Omit<TranscriptEntry, 'ts'>): void {
    const now = Date.now()
    this.state.transcript.push({ ...entry, ts: now })
    this.state.lastTurnAt = now
  }

  incTurn(): void { this.state.turnCount++; this.state.lastTurnAt = Date.now() }

  incEmpty(): void { this.state.consecutiveEmptyInputs++ }
  resetEmpty(): void { this.state.consecutiveEmptyInputs = 0 }

  abort(_reason: string): void { this.state.abortController.abort() }
}

export class SessionRegistry {
  private readonly sessions = new Map<string, CallSession>()

  add(s: CallSession): void { this.sessions.set(s.state.callId, s) }
  get(callId: string): CallSession | undefined { return this.sessions.get(callId) }
  delete(callId: string): void { this.sessions.delete(callId) }
  size(): number { return this.sessions.size }
  list(): CallSession[] { return Array.from(this.sessions.values()) }
}
