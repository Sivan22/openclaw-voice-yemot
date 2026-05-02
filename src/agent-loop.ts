import { parseAgentReply, AgentReplyParseError } from './agent-reply.js'
import type { AgentReply } from './types.js'
import type { CallSession } from './call-session.js'

export interface AgentContext {
  channel: 'voice-yemot'
  callId: string
  phone: string
  did: string
  language: string
  systemPromptAddon: string
}

export interface AgentRunInput {
  agentName: string
  input: string
  context: AgentContext
  conversationId: string
  signal?: AbortSignal
}

export type AgentRunner = (input: AgentRunInput) => Promise<string>

export interface AgentLoopConfig {
  agentName: string
  systemPromptAddon: string
  responseTimeoutMs: number
  fallbackErrorMessage: string
}

export class AgentTimeoutError extends Error {
  constructor() { super('agent timed out'); this.name = 'AgentTimeoutError' }
}

export interface AgentLoopOptions {
  runner: AgentRunner
  cfg: AgentLoopConfig
}

const SENTINEL_CALL_STARTED = '__call_started__'

export class AgentLoop {
  constructor(private readonly opts: AgentLoopOptions) {}

  firstTurn(session: CallSession): Promise<AgentReply> {
    return this.callAgent(session, SENTINEL_CALL_STARTED)
  }

  nextTurn(session: CallSession, userInput: string): Promise<AgentReply> {
    return this.callAgent(session, userInput)
  }

  private async callAgent(session: CallSession, input: string): Promise<AgentReply> {
    const ctx: AgentContext = {
      channel: 'voice-yemot',
      callId: session.state.callId,
      phone: session.state.phone,
      did: session.state.did,
      language: session.state.language,
      systemPromptAddon: this.opts.cfg.systemPromptAddon,
    }

    let raw = await this.runWithTimeout({
      agentName: this.opts.cfg.agentName,
      input,
      context: ctx,
      conversationId: session.state.callId,
      signal: session.state.abortController.signal,
    })

    // 1st parse attempt
    let parsed: AgentReply | undefined
    try {
      parsed = parseAgentReply(raw, { strict: true })
    } catch (e) {
      if (!(e instanceof AgentReplyParseError)) throw e
      // 2nd attempt with corrective prompt
      const corrective =
        `Your previous reply was not valid JSON. Reply with strict JSON: ` +
        `{"spoken":"<text>","mode":"stt"|"tap","tap":{"digits":[...],"maxDigits":n,"timeoutSec":n},"end":false|true}.\n` +
        `Original input: ${input}`
      raw = await this.runWithTimeout({
        agentName: this.opts.cfg.agentName,
        input: corrective,
        context: ctx,
        conversationId: session.state.callId,
        signal: session.state.abortController.signal,
      })
      try {
        parsed = parseAgentReply(raw, { strict: true })
      } catch {
        // Final fallback: auto-wrap as plain text
        parsed = parseAgentReply(raw, { strict: false })
      }
    }

    // Coerce empty
    if (!parsed.spoken || parsed.spoken.trim() === '') {
      parsed = { ...parsed, spoken: this.opts.cfg.fallbackErrorMessage }
    }
    return parsed
  }

  private async runWithTimeout(input: AgentRunInput): Promise<string> {
    const ms = this.opts.cfg.responseTimeoutMs
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<string>((_, reject) => {
      timer = setTimeout(() => reject(new AgentTimeoutError()), ms)
    })
    try {
      const result = await Promise.race([this.opts.runner(input), timeout])
      return result
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
