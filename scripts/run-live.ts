#!/usr/bin/env tsx
/**
 * Live runner — boots YemotService against the real Yemot system, with a
 * canned-reply agent so we can phone in and exercise the full path:
 *   bootstrap → webhook → TTS → STT → end.
 *
 * Reads env from process.env (use a .env loader like `dotenv` or `tsx --env-file`).
 *
 * Required env:
 *   YEMOT_SYSTEM_NUMBER, YEMOT_USERNAME, YEMOT_PASSWORD,
 *   VOICE_YEMOT_PUBLIC_URL, VOICE_YEMOT_SHARED_SECRET
 * Optional env:
 *   YEMOT_EXTENSION_NUMBER (default '' = root, path 'ivr2:/'),
 *   YEMOT_EXTENSION_TITLE  (default 'OpenClaw Voice (live test)'),
 *   VOICE_YEMOT_WEBHOOK_PATH (default '/yemot'),
 *   PORT (default 3000),
 *   YEMOT_API_BASE_URL (default https://www.call2all.co.il/ym/api/)
 */

import { YemotService } from '../src/service.js'
import type { AgentRunInput } from '../src/agent-loop.js'
import type { PluginConfig } from '../src/types.js'

function need(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing env var: ${name}`)
    process.exit(2)
  }
  return v
}

/**
 * Stub agent: greets, echoes one user turn, then ends the call.
 * Keyed by conversationId so concurrent calls don't share state.
 */
function buildStubAgent() {
  const turnCount = new Map<string, number>()
  return async (input: AgentRunInput): Promise<string> => {
    const n = (turnCount.get(input.conversationId) ?? 0) + 1
    turnCount.set(input.conversationId, n)

    if (n === 1) {
      // First webhook (sentinel __call_started__) — greet the caller.
      // Using tap (DTMF) instead of stt to avoid Yemot speech-recognition unit cost.
      return JSON.stringify({
        spoken: 'שלום, זאת בדיקה. אנא הקש מספר בין אחד לחמש ואז סולמית.',
        mode: 'tap',
        tap: { digits: ['1', '2', '3', '4', '5'], maxDigits: 1, minDigits: 1, timeoutSec: 10 },
        end: false,
      })
    }
    // User pressed something — echo it and hang up.
    const heard = input.input.trim() || '(לא הקשת כלום)'
    return JSON.stringify({
      spoken: `הקשת ${heard}. תודה רבה, להתראות.`,
      end: true,
    })
  }
}

async function main(): Promise<void> {
  const cfg: PluginConfig = {
    yemot: {
      systemNumber:    need('YEMOT_SYSTEM_NUMBER'),
      username:        need('YEMOT_USERNAME'),
      password:        need('YEMOT_PASSWORD'),
      extensionNumber: process.env.YEMOT_EXTENSION_NUMBER ?? '',
      extensionTitle:  process.env.YEMOT_EXTENSION_TITLE ?? 'OpenClaw Voice (live test)',
      apiBaseUrl:      process.env.YEMOT_API_BASE_URL ?? 'https://www.call2all.co.il/ym/api/',
      language:        'he-IL',
      removeInvalidTtsChars: true,
      autoConfigureExtension: true,
    },
    server: {
      port: Number(process.env.PORT ?? 3000),
      host: '0.0.0.0',
      webhookPath: process.env.VOICE_YEMOT_WEBHOOK_PATH ?? '/yemot',
      publicBaseUrl: need('VOICE_YEMOT_PUBLIC_URL'),
      sharedSecret: need('VOICE_YEMOT_SHARED_SECRET'),
      disableAuth: false,
    },
    agent: {
      name: 'stub-echo',
      systemPromptAddon: '',
      responseTimeoutMs: 30_000,
      maxTurnsPerCall: 5,
    },
    call: {
      defaultMode: 'stt',
      sttQuietMaxSec: 3,
      sttMaxLengthSec: 30,
      callIdleTimeoutSec: 60,
      fallbackErrorMessage: 'אירעה שגיאה. השיחה מסתיימת.',
    },
    persistence: { transcripts: false, logDir: './var' },
  }

  const logger = {
    info:  (m: string, c?: unknown) => console.log(`[info]  ${m}`,  c ?? ''),
    warn:  (m: string, c?: unknown) => console.warn(`[warn]  ${m}`,  c ?? ''),
    error: (m: string, c?: unknown) => console.error(`[error] ${m}`, c ?? ''),
    debug: (m: string, c?: unknown) => console.log(`[debug] ${m}`, c ?? ''),
  }

  const svc = new YemotService({
    cfg,
    logger,
    runner: buildStubAgent(),
    onEvent: e => console.log(`[event] ${e.type}`, 'session' in e ? { callId: e.session.callId } : {}),
  })

  await svc.start()
  console.log('=== voice-yemot live runner ===')
  console.log(`  listening: 127.0.0.1:${svc.state().port}`)
  console.log(`  publicUrl: ${cfg.server.publicBaseUrl}${cfg.server.webhookPath}`)
  console.log(`  bootstrap: ${svc.state().bootstrapStatus}`)
  console.log(`  Now dial ${cfg.yemot.systemNumber} from a phone.`)
  console.log('  Ctrl+C to stop.')

  // Print state once a second for the first 10s so we can see bootstrap result.
  let ticks = 0
  const probe = setInterval(() => {
    ticks++
    const s = svc.state()
    console.log(`[state] bootstrap=${s.bootstrapStatus}${s.bootstrapError ? ` err="${s.bootstrapError}"` : ''} active=${s.activeCallCount}`)
    if (ticks >= 10 || (s.bootstrapStatus !== 'pending' && ticks >= 2)) {
      clearInterval(probe)
    }
  }, 1000)

  const shutdown = async (): Promise<void> => {
    console.log('\nshutting down...')
    await svc.stop()
    process.exit(0)
  }
  process.on('SIGINT',  shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(e => {
  console.error('FATAL', e)
  process.exit(1)
})
