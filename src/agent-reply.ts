import { z } from 'zod'
import type { AgentReply } from './types.js'

export class AgentReplyParseError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message)
    this.name = 'AgentReplyParseError'
  }
}

const TapSchema = z.object({
  digits: z.array(z.string().min(1)).min(1),
  maxDigits: z.number().int().min(1),
  minDigits: z.number().int().min(1).optional(),
  timeoutSec: z.number().int().min(1),
})

const ReplySchema = z.object({
  spoken: z.string(),
  mode: z.enum(['stt', 'tap']).optional(),
  tap: TapSchema.optional(),
  end: z.boolean().optional(),
}).refine((r) => r.mode !== 'tap' || r.tap !== undefined, {
  message: 'mode=tap requires tap options',
  path: ['tap'],
})

export interface ParseOptions {
  strict?: boolean        // default false: malformed JSON falls back to auto-wrap
}

export function parseAgentReply(raw: string, opts: ParseOptions = {}): AgentReply {
  const strict = opts.strict ?? false
  const trimmed = raw.trimStart()
  const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[')

  if (!looksLikeJson) {
    return { spoken: raw, mode: 'stt', end: false }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (e) {
    if (strict) throw new AgentReplyParseError(`malformed JSON: ${(e as Error).message}`, raw)
    return { spoken: raw, mode: 'stt', end: false }
  }

  const validated = ReplySchema.safeParse(parsed)
  if (!validated.success) {
    if (strict) {
      throw new AgentReplyParseError(`schema validation failed: ${validated.error.message}`, raw)
    }
    return { spoken: raw, mode: 'stt', end: false }
  }

  return {
    spoken: validated.data.spoken,
    mode: validated.data.mode ?? 'stt',
    tap: validated.data.tap,
    end: validated.data.end ?? false,
  }
}
