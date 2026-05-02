import { CallSession, SessionRegistry } from './call-session.js'
import type { AgentLoop } from './agent-loop.js'
import { renderPromptDirective } from './prompt-render.js'
import type { NormalizedEvent } from './events.js'
import type { CallEndReason } from './types.js'

export interface RouterBridgeCfg {
  defaultMode: 'stt' | 'tap'
  sttQuietMaxSec: number
  sttMaxLengthSec: number
  language: string
  removeInvalidTtsChars: boolean
  fallbackErrorMessage: string
  maxTurnsPerCall: number
}

export interface BuildHandlerArgs {
  registry: SessionRegistry
  agentLoop: AgentLoop
  cfg: RouterBridgeCfg
  emit: (e: NormalizedEvent) => void
}

/**
 * Minimal subset of yemot-router2's Call object used by the handler.
 * Kept narrow so we can fake it in unit tests without depending on the real lib.
 */
export interface YemotCallLike {
  ApiCallId: string
  callId: string
  phone: string
  did: string
  real_did: string
  extension: string
  ApiPhone: string
  ApiDID: string
  ApiRealDID: string
  ApiExtension: string
  read(messages: { type: string; data: string }[], mode: 'stt' | 'tap' | 'record', opts?: unknown): Promise<string>
  id_list_message(messages: { type: string; data: string }[], opts?: unknown): never
  hangup(): never
}

export function buildCallHandler(args: BuildHandlerArgs): (call: YemotCallLike) => Promise<void> {
  const { registry, agentLoop, cfg, emit } = args

  return async function handler(call: YemotCallLike): Promise<void> {
    const session = new CallSession({
      callId: call.ApiCallId,
      phone: call.ApiPhone,
      did: call.ApiDID,
      realDid: call.ApiRealDID,
      extension: call.ApiExtension,
      language: cfg.language,
    })
    registry.add(session)
    emit({ type: 'call.initiated', session: session.state })

    let endReason: CallEndReason = 'completed'
    let inRead = false
    let nextPrompt
    try {
      nextPrompt = await agentLoop.firstTurn(session)
      session.appendTranscript({ speaker: 'bot', text: nextPrompt.spoken, isFinal: true })
      emit({ type: 'call.speaking', session: session.state, text: nextPrompt.spoken })

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (nextPrompt.end) {
          call.id_list_message(renderPromptDirective(nextPrompt.spoken, { stripInvalidChars: cfg.removeInvalidTtsChars }))
          // never reached (id_list_message throws)
          break
        }

        inRead = true
        const userInput = await call.read(
          renderPromptDirective(nextPrompt.spoken, { stripInvalidChars: cfg.removeInvalidTtsChars }),
          nextPrompt.mode,
          modeOptions(nextPrompt, cfg),
        )
        inRead = false

        if (userInput === '') {
          session.incEmpty()
          if (session.state.consecutiveEmptyInputs >= 2) {
            endReason = 'idle-timeout'
            // Play a fallback and exit
            call.id_list_message(renderPromptDirective(cfg.fallbackErrorMessage, { stripInvalidChars: cfg.removeInvalidTtsChars }))
            break
          }
        } else {
          session.resetEmpty()
        }

        session.appendTranscript({ speaker: 'user', text: userInput, isFinal: true })
        if (nextPrompt.mode === 'tap') {
          emit({ type: 'call.dtmf', session: session.state, digits: userInput })
        } else {
          emit({ type: 'call.speech', session: session.state, text: userInput, isFinal: true })
        }

        session.incTurn()
        if (session.state.turnCount >= cfg.maxTurnsPerCall) {
          endReason = 'max-turns'
          call.id_list_message(renderPromptDirective(cfg.fallbackErrorMessage, { stripInvalidChars: cfg.removeInvalidTtsChars }))
          break
        }

        nextPrompt = await agentLoop.nextTurn(session, userInput)
        session.appendTranscript({ speaker: 'bot', text: nextPrompt.spoken, isFinal: true })
        emit({ type: 'call.speaking', session: session.state, text: nextPrompt.spoken })
      }
    } catch (e) {
      if (isExitError(e)) {
        // id_list_message intentionally throws to terminate; not an error.
        // If thrown from inside read(), the caller hung up.
        if (inRead) endReason = 'hangup-user'
      } else if (inRead) {
        // An unexpected error from read() means the caller's audio channel
        // dropped — treat as caller hangup, not as an internal error.
        endReason = 'hangup-user'
      } else {
        endReason = 'error'
        emit({ type: 'call.error', session: session.state, error: e as Error, retryable: false })
        // Best-effort fallback play. Wrap in try to avoid double-throw.
        try {
          call.id_list_message(renderPromptDirective(cfg.fallbackErrorMessage, { stripInvalidChars: cfg.removeInvalidTtsChars }))
        } catch {
          // already exiting
        }
      }
    } finally {
      // If the call's hangup-via-Yemot triggered (via call_hangup event), the registry
      // is cleaned by the event handler; here we cover normal-exit paths.
      if (session.state.abortController.signal.aborted) {
        endReason = 'hangup-user'
      }
      emit({ type: 'call.ended', session: session.state, reason: endReason })
      registry.delete(session.state.callId)
    }
  }
}

function modeOptions(reply: { mode: 'stt' | 'tap'; tap?: { digits: string[]; maxDigits: number; minDigits?: number; timeoutSec: number } }, cfg: RouterBridgeCfg): unknown {
  if (reply.mode === 'tap' && reply.tap) {
    return {
      max_digits: reply.tap.maxDigits,
      min_digits: reply.tap.minDigits ?? 1,
      sec_wait: reply.tap.timeoutSec,
      digits_allowed: reply.tap.digits,
    }
  }
  // yemot-router2 stt mode: `quiet_max` and `max_length` are only valid when
  // `use_records_recognition_engine: true`. But that engine forbids `block_typing`,
  // which is set to `false` by router defaults — there's no clean way to pass them
  // both. We use the simpler stt mode (no records engine), so quiet_max / max_length
  // from cfg are intentionally ignored here. (They remain in cfg for future use, e.g.
  // when running directly against records-recognition.)
  return {
    lang: cfg.language,
  }
}

function isExitError(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'name' in e && (e as { name: unknown }).name === 'ExitError'
}
