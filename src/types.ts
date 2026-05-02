/**
 * Voice-Yemot addin types. Shapes mirror voice-call's vocabulary where useful
 * (CallSession, TranscriptEntry) but are not direct imports — voice-call does
 * not export them as a public SDK.
 */

export interface YemotConfig {
  systemNumber: string
  username: string
  password: string
  extensionNumber: string
  extensionTitle: string
  apiBaseUrl: string
  language: string
  removeInvalidTtsChars: boolean
  autoConfigureExtension: boolean
}

export interface ServerConfig {
  port: number
  host: string
  webhookPath: string
  publicBaseUrl: string
  sharedSecret: string
  disableAuth: boolean
}

export interface AgentConfig {
  name: string
  systemPromptAddon: string
  responseTimeoutMs: number
  maxTurnsPerCall: number
}

export interface CallConfigSection {
  defaultMode: 'stt' | 'tap'
  sttQuietMaxSec: number
  sttMaxLengthSec: number
  callIdleTimeoutSec: number
  fallbackErrorMessage: string
}

export interface PersistenceConfig {
  transcripts: boolean
  logDir: string
}

export interface PluginConfig {
  yemot: YemotConfig
  server: ServerConfig
  agent: AgentConfig
  call: CallConfigSection
  persistence: PersistenceConfig
}

export interface TranscriptEntry {
  speaker: 'user' | 'bot'
  text: string
  isFinal: boolean
  ts: number
}

export interface CallSessionState {
  callId: string                 // ApiCallId
  phone: string                  // ApiPhone (caller)
  did: string                    // ApiDID
  realDid: string                // ApiRealDID
  extension: string              // ApiExtension
  language: string
  startedAt: number
  lastTurnAt: number
  transcript: TranscriptEntry[]
  turnCount: number
  abortController: AbortController
  consecutiveEmptyInputs: number
}

export type AgentReplyMode = 'stt' | 'tap'

export interface AgentReplyTapOptions {
  digits: string[]               // e.g. ["1","2","9"] or ["10","20","30"]
  maxDigits: number
  minDigits?: number
  timeoutSec: number
}

export interface AgentReply {
  spoken: string
  mode: AgentReplyMode
  tap?: AgentReplyTapOptions
  end: boolean
}

export type CallEndReason =
  | 'completed'         // bot reply with end:true
  | 'hangup-user'       // caller hung up
  | 'shutdown'          // service stopping
  | 'error'             // fatal during the call
  | 'idle-timeout'      // exceeded callIdleTimeoutSec
  | 'max-turns'         // exceeded agent.maxTurnsPerCall
