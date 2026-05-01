# OpenClaw Voice Channel Addin (Yemot Hamashiach) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `openclaw-voice-yemot` v1 — a standalone OpenClaw plugin that handles inbound Hebrew phone calls on Yemot Hamashiach, driving a per-turn LLM agent via Yemot's built-in TTS and ASR/DTMF, with one-step setup (auto-configures the Yemot extension via REST).

**Architecture:** Standalone OpenClaw plugin (`definePluginEntry`) registering a long-lived service that owns an Express server with `yemot-router2` mounted on it. Each call runs as an async coroutine; user input → `api.runtime.agent.run` → text reply → next Yemot prompt. Mirrors the bundled `voice-call` extension's data shapes (`CallSession`, `NormalizedEvent`, `TranscriptEntry`) without trying to fit through its `VoiceCallProvider` interface.

**Tech Stack:** TypeScript (ESM), Node.js 20+, Express 4, [`yemot-router2`](https://github.com/ShlomoCode/yemot-router2), [`MusiCode1/yemot-api`](https://github.com/MusiCode1/yemot-api), `zod` for runtime validation, `vitest` + `nock` for testing.

**Spec:** `docs/superpowers/specs/2026-05-01-voice-yemot-addin-design.md`

---

## File map

```
openclaw-voice-yemot/  (= /root/yemot-ivr-openclaw-addin/)
├── package.json                       # Task 1
├── tsconfig.json                      # Task 1
├── vitest.config.ts                   # Task 1
├── .gitignore                         # Task 1
├── .eslintrc.cjs                      # Task 1
├── openclaw.plugin.json               # Task 16  (manifest, JSON Schema config)
├── index.ts                           # Task 17  (definePluginEntry default export)
├── README.md                          # Task 18
├── src/
│   ├── types.ts                       # Task 3   (Config, CallSession, AgentReply types)
│   ├── events.ts                      # Task 3   (NormalizedEvent shapes)
│   ├── prompt-render.ts               # Task 4   (TTS char stripping, message conversion)
│   ├── auth.ts                        # Task 5   (Express middleware: shared-secret check)
│   ├── agent-reply.ts                 # Task 6   (strict JSON + auto-wrap, zod schema)
│   ├── yemot-rest/
│   │   ├── client.ts                  # Task 7   (wrapper over yemot-api: Login, UpdateExtension, GetIVR2Dir)
│   │   └── bootstrap.ts               # Task 8   (idempotent extension setup with retry/fallback)
│   ├── call-session.ts                # Task 9   (CallSession class, SessionRegistry Map)
│   ├── agent-loop.ts                  # Task 10  (firstTurn, nextTurn — agent runtime bridge)
│   ├── router-bridge.ts               # Task 12  (async (call) handler, the loop)
│   ├── service.ts                     # Task 13  (YemotService — Express + router + lifecycle)
│   ├── gateway-methods.ts             # Task 15  (voiceyemot.status / list / end)
│   └── logging.ts                     # Task 13  (structured logging via api.logger)
├── test/
│   ├── helpers/
│   │   ├── mock-yemot.ts              # Task 11  (replays Yemot's webhook protocol)
│   │   └── stub-agent.ts              # Task 14  (deterministic agent stub)
│   ├── unit/                          # Tasks 4-10, 13, 15
│   └── integration/                   # Task 14
└── scripts/
    └── smoke.ts                       # Task 18  (npm run smoke — real-system test)
```

**Constraints honored throughout:**
- TDD: each functional unit has tests written first, run failing, then implementation
- One source file = one responsibility (per spec §10)
- DRY: shared test fixtures in `test/helpers/`
- YAGNI: only Tier 1 features; no abstractions for deferred tiers
- Frequent commits: one commit per task (occasionally per step on long tasks)

---

## Task 1: Project skeleton (package.json, TypeScript, vitest, ESLint, gitignore)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.eslintrc.cjs`

This is a non-functional foundation task. No tests; we're setting up the toolchain so subsequent tasks can run TDD.

- [ ] **Step 1: Write `.gitignore`**

```
node_modules/
dist/
coverage/
.DS_Store
*.log
var/
.env
.env.local
.env.*.local
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "openclaw-voice-yemot",
  "version": "0.1.0",
  "description": "OpenClaw voice-channel addin for Yemot Hamashiach (ימות המשיח)",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "openclaw.plugin.json",
    "README.md"
  ],
  "openclaw": {
    "extensions": ["./dist/index.js"],
    "compat": { "pluginApi": "^1.0.0" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --ext .ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run test/unit",
    "test:integration": "vitest run test/integration",
    "smoke": "tsx scripts/smoke.ts",
    "prepublishOnly": "npm run build"
  },
  "engines": { "node": ">=20.0.0" },
  "dependencies": {
    "express": "^4.21.2",
    "yemot-router2": "^2.5.0",
    "yemot-api": "^1.5.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.16.10",
    "@typescript-eslint/eslint-plugin": "^7.18.0",
    "@typescript-eslint/parser": "^7.18.0",
    "eslint": "^8.57.1",
    "nock": "^13.5.5",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  },
  "license": "MIT"
}
```

NB: lock the exact `yemot-router2` and `yemot-api` versions in Task 2 after the availability check; the floats above are placeholders that may be downgraded.

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": ".",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "lib": ["ES2022"]
  },
  "include": ["index.ts", "src/**/*.ts", "scripts/**/*.ts", "test/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globals: false,
    environment: 'node',
    testTimeout: 10_000,
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'index.ts'],
      exclude: ['src/**/*.d.ts', 'src/types.ts', 'src/events.ts']
    }
  }
})
```

- [ ] **Step 5: Write `.eslintrc.cjs`**

```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2022: true },
  ignorePatterns: ['dist/', 'coverage/', 'node_modules/'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn'
  }
}
```

- [ ] **Step 6: Install deps and verify the toolchain runs**

Run:
```bash
cd /root/yemot-ivr-openclaw-addin
npm install
npm run typecheck
```

Expected: typecheck passes (the project has no source files yet, so it checks an empty include set — that's fine).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .eslintrc.cjs
git commit -m "Add project skeleton (TypeScript ESM, vitest, ESLint)"
```

---

## Task 2: Verify MusiCode1/yemot-api compatibility & lock versions

**Files:**
- Modify: `package.json` (lock dep versions)
- Create: `scripts/check-yemot-api.mjs` (one-off compatibility check; deleted after — committed only if useful)

The spec's main risk #2 is that `yemot-api` may not work on current Node. This task exercises the package's basic shape; if broken, we fall back to a thin in-house client (~80 LOC) over `node:fetch` for `Login`, `UpdateExtension`, `GetIVR2Dir`.

- [ ] **Step 1: Write the smoke probe script**

Create `scripts/check-yemot-api.mjs`:
```js
// Smoke probe — does yemot-api load and expose the methods we need?
import('yemot-api')
  .then(mod => {
    const exported = Object.keys(mod)
    console.log('exports:', exported.join(', '))
    // We use: a constructor that takes username/password (Login),
    // and methods named UpdateExtension and GetIVR2Dir (or equivalents).
    const ctor = mod.default ?? mod.YemotApi ?? mod.Api
    if (!ctor) {
      console.error('FAIL: no default/YemotApi/Api constructor found')
      process.exit(2)
    }
    console.log('constructor:', ctor.name || '(anonymous)')
    const proto = Object.getOwnPropertyNames(ctor.prototype || {})
    console.log('prototype methods:', proto.join(', '))
    const needed = ['UpdateExtension', 'GetIVR2Dir', 'Login']
    const missing = needed.filter(n =>
      !proto.includes(n) && !proto.includes(n.toLowerCase()))
    if (missing.length) {
      console.error('FAIL: missing methods:', missing.join(', '))
      process.exit(3)
    }
    console.log('OK')
    process.exit(0)
  })
  .catch(err => {
    console.error('FAIL: import error:', err.message)
    process.exit(1)
  })
```

- [ ] **Step 2: Run the probe**

```bash
node scripts/check-yemot-api.mjs
```

If it prints `OK` → we proceed using `yemot-api`. Lock the version that worked.
If it prints `FAIL: …` → we cannot use `yemot-api`. **Pivot to fallback**: skip the dep, write a thin REST client in Task 7 directly using `node:fetch`. Document the decision in a commit message.

- [ ] **Step 3: Lock the working `yemot-router2` version too**

```bash
npm view yemot-router2 version       # latest published version
npm view yemot-router2 dependencies  # check Express compat
```

If `yemot-router2` requires Express 4 and we have 4: good. If it pins something incompatible: pin a compatible older version.

- [ ] **Step 4: Update `package.json` with locked versions**

Update the `dependencies` block to use exact versions (not `^`) for the two Yemot deps, e.g.:
```json
"yemot-router2": "2.5.0",
"yemot-api": "1.5.0"
```

If `yemot-api` failed in Step 2, **remove** it from `dependencies` entirely; record the decision.

- [ ] **Step 5: Re-install with locked versions**

```bash
rm -rf node_modules package-lock.json
npm install
npm run typecheck
```

- [ ] **Step 6: Delete the probe script (no longer needed)**

```bash
rm scripts/check-yemot-api.mjs
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json
git commit -m "Lock yemot-router2 and yemot-api versions, verified compat"
```
(If you pivoted to in-house REST: commit message should be `Lock yemot-router2; pivot off yemot-api (incompatible) — will use node:fetch in src/yemot-rest/client.ts`.)

---

## Task 3: Core types and event shapes

**Files:**
- Create: `src/types.ts`
- Create: `src/events.ts`

Type-only files (no runtime logic), so no dedicated tests. Subsequent tasks consume these types and exercise them indirectly. Keeping them in dedicated files limits surface area.

- [ ] **Step 1: Write `src/types.ts`**

```ts
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
```

- [ ] **Step 2: Write `src/events.ts`**

```ts
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
```

- [ ] **Step 3: Verify it typechecks**

```bash
npm run typecheck
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/events.ts
git commit -m "Add core types and normalized event vocabulary"
```

---

## Task 4: Prompt rendering (TTS char stripping)

**Files:**
- Create: `src/prompt-render.ts`
- Test: `test/unit/prompt-render.test.ts`

Pure function that converts agent text → a `yemot-router2` `Msg[]` for the `read`/`id_list_message` directive, stripping the chars Yemot's TTS engine forbids (`."'-&|`) when configured.

- [ ] **Step 1: Write the failing test**

Create `test/unit/prompt-render.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { renderPromptDirective, stripInvalidTtsChars } from '../../src/prompt-render.js'

describe('stripInvalidTtsChars', () => {
  it('removes the six forbidden chars', () => {
    expect(stripInvalidTtsChars('hello.world-test"x\'y&z|done'))
      .toBe('helloworldtestxyzdone')
  })

  it('preserves Hebrew niqqud and standard letters', () => {
    expect(stripInvalidTtsChars('שָׁלוֹם עוֹלָם'))
      .toBe('שָׁלוֹם עוֹלָם')
  })

  it('preserves spaces, digits, and punctuation that are allowed', () => {
    expect(stripInvalidTtsChars('היום 14:00, מחר ב9'))
      .toBe('היום 14:00, מחר ב9')
  })

  it('handles empty string', () => {
    expect(stripInvalidTtsChars('')).toBe('')
  })
})

describe('renderPromptDirective', () => {
  it('returns a single text Msg when given plain Hebrew', () => {
    expect(renderPromptDirective('שלום!', { stripInvalidChars: true }))
      .toEqual([{ type: 'text', data: 'שלום!' }])
  })

  it('strips forbidden chars when stripInvalidChars=true', () => {
    expect(renderPromptDirective('שלום-עולם', { stripInvalidChars: true }))
      .toEqual([{ type: 'text', data: 'שלוםעולם' }])
  })

  it('keeps forbidden chars when stripInvalidChars=false', () => {
    expect(renderPromptDirective('שלום-עולם', { stripInvalidChars: false }))
      .toEqual([{ type: 'text', data: 'שלום-עולם' }])
  })

  it('coerces non-string text to string', () => {
    expect(renderPromptDirective(123 as unknown as string, { stripInvalidChars: true }))
      .toEqual([{ type: 'text', data: '123' }])
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npx vitest run test/unit/prompt-render.test.ts
```

Expected: fails because `src/prompt-render.ts` doesn't exist yet.

- [ ] **Step 3: Implement `src/prompt-render.ts`**

```ts
const FORBIDDEN_TTS_CHARS = /[.\-"'&|]/g

export function stripInvalidTtsChars(text: string): string {
  return text.replace(FORBIDDEN_TTS_CHARS, '')
}

export interface YemotMsg {
  type: 'text' | 'file' | 'system_message'
  data: string
}

export interface RenderOptions {
  stripInvalidChars: boolean
}

export function renderPromptDirective(
  text: string,
  opts: RenderOptions
): YemotMsg[] {
  const s = String(text ?? '')
  const data = opts.stripInvalidChars ? stripInvalidTtsChars(s) : s
  return [{ type: 'text', data }]
}
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
npx vitest run test/unit/prompt-render.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/prompt-render.ts test/unit/prompt-render.test.ts
git commit -m "Add prompt-render with TTS char stripping (TDD)"
```

---

## Task 5: Webhook auth middleware

**Files:**
- Create: `src/auth.ts`
- Test: `test/unit/auth.test.ts`

Express middleware that checks the `secret` query param against the configured `sharedSecret` using a constant-time comparison. Skips when `disableAuth: true`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/auth.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npx vitest run test/unit/auth.test.ts
```

Expected: fails — `src/auth.ts` doesn't exist.

- [ ] **Step 3: Implement `src/auth.ts`**

```ts
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
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
npx vitest run test/unit/auth.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts test/unit/auth.test.ts
git commit -m "Add webhook auth middleware (constant-time secret check)"
```

---

## Task 6: Agent reply parser (strict JSON + auto-wrap)

**Files:**
- Create: `src/agent-reply.ts`
- Test: `test/unit/agent-reply.test.ts`

Parses the agent runtime's response into an `AgentReply`. Accepts strict JSON `{spoken, mode?, tap?, end?}` with zod validation, OR plain text (auto-wrapped to `{spoken: text, mode: 'stt', end: false}`). Defaults are filled in.

- [ ] **Step 1: Write the failing test**

Create `test/unit/agent-reply.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseAgentReply, AgentReplyParseError } from '../../src/agent-reply.js'
import type { AgentReply } from '../../src/types.js'

describe('parseAgentReply', () => {
  it('auto-wraps plain text to stt mode, end=false', () => {
    const r = parseAgentReply('שלום!')
    expect(r).toEqual<AgentReply>({ spoken: 'שלום!', mode: 'stt', end: false })
  })

  it('parses strict JSON with all fields', () => {
    const json = JSON.stringify({
      spoken: 'בחר מספר',
      mode: 'tap',
      tap: { digits: ['1', '2', '3'], maxDigits: 1, timeoutSec: 5 },
      end: false,
    })
    expect(parseAgentReply(json)).toEqual<AgentReply>({
      spoken: 'בחר מספר',
      mode: 'tap',
      tap: { digits: ['1', '2', '3'], maxDigits: 1, timeoutSec: 5 },
      end: false,
    })
  })

  it('parses JSON with end:true', () => {
    expect(parseAgentReply('{"spoken":"להתראות","end":true}'))
      .toEqual<AgentReply>({ spoken: 'להתראות', mode: 'stt', end: true })
  })

  it('parses JSON with only spoken (defaults filled)', () => {
    expect(parseAgentReply('{"spoken":"שלום"}'))
      .toEqual<AgentReply>({ spoken: 'שלום', mode: 'stt', end: false })
  })

  it('falls through to auto-wrap when JSON is malformed and `strict=false`', () => {
    expect(parseAgentReply('{not valid json', { strict: false }))
      .toEqual<AgentReply>({ spoken: '{not valid json', mode: 'stt', end: false })
  })

  it('throws AgentReplyParseError for malformed JSON when strict=true', () => {
    expect(() => parseAgentReply('{not valid json', { strict: true }))
      .toThrow(AgentReplyParseError)
  })

  it('throws AgentReplyParseError when JSON object missing `spoken`', () => {
    expect(() => parseAgentReply('{"mode":"stt"}', { strict: true }))
      .toThrow(AgentReplyParseError)
  })

  it('throws when mode=tap but tap field absent', () => {
    expect(() => parseAgentReply('{"spoken":"x","mode":"tap"}', { strict: true }))
      .toThrow(AgentReplyParseError)
  })

  it('rejects extra unknown fields silently when strict=false (forgiving)', () => {
    const r = parseAgentReply('{"spoken":"hi","weird":42}', { strict: false })
    expect(r.spoken).toBe('hi')
    expect((r as unknown as { weird?: number }).weird).toBeUndefined()
  })

  it('coerces empty/whitespace-only strings to {spoken:"", mode:stt, end:false}', () => {
    expect(parseAgentReply('   '))
      .toEqual<AgentReply>({ spoken: '   ', mode: 'stt', end: false })
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npx vitest run test/unit/agent-reply.test.ts
```

Expected: fails — module missing.

- [ ] **Step 3: Implement `src/agent-reply.ts`**

```ts
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
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
npx vitest run test/unit/agent-reply.test.ts
```

Expected: 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/agent-reply.ts test/unit/agent-reply.test.ts
git commit -m "Add agent-reply parser (strict JSON + plain-text auto-wrap)"
```

---

## Task 7: Yemot REST client wrapper

**Files:**
- Create: `src/yemot-rest/client.ts`
- Test: `test/unit/yemot-rest-client.test.ts`

Thin wrapper around either `MusiCode1/yemot-api` (preferred, per Task 2) or `node:fetch` (fallback). Exposes only the three methods we need: `login`, `updateExtension`, `getIVR2Dir`. Tests use `nock` to mock the actual HTTP endpoints; the wrapper's internal choice (lib vs fetch) doesn't matter to the tests because they exercise the public method shape.

This task assumes Task 2 confirmed `yemot-api` works. **If Task 2 pivoted to fallback,** swap the implementation in Step 3 with a direct `node:fetch` version (see Step 3b alternative below).

- [ ] **Step 1: Write the failing test**

Create `test/unit/yemot-rest-client.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import nock from 'nock'
import { YemotRestClient } from '../../src/yemot-rest/client.js'

const BASE = 'https://www.call2all.co.il'
const PATH = '/ym/api'

describe('YemotRestClient', () => {
  beforeEach(() => { nock.cleanAll() })
  afterEach(() => { nock.cleanAll() })

  it('login: returns the token from response', async () => {
    nock(BASE)
      .post(PATH + '/Login', body => /username=u&password=p/.test(body as string))
      .reply(200, { responseStatus: 'OK', token: 'tok-123' })

    const c = new YemotRestClient({ baseUrl: BASE + PATH + '/' })
    const tok = await c.login({ username: 'u', password: 'p' })
    expect(tok).toBe('tok-123')
  })

  it('login: throws on responseStatus != OK', async () => {
    nock(BASE)
      .post(PATH + '/Login')
      .reply(200, { responseStatus: 'EXCEPTION', message: 'bad creds' })

    const c = new YemotRestClient({ baseUrl: BASE + PATH + '/' })
    await expect(c.login({ username: 'u', password: 'wrong' })).rejects.toThrow(/bad creds/)
  })

  it('updateExtension: posts the merged ext.ini fields', async () => {
    let captured = ''
    nock(BASE)
      .post(PATH + '/UpdateExtension', body => { captured = body as string; return true })
      .reply(200, { responseStatus: 'OK' })

    const c = new YemotRestClient({ baseUrl: BASE + PATH + '/' })
    await c.updateExtension('tok-123', {
      path: 'ivr2:/1',
      type: 'api',
      title: 'OpenClaw Voice',
      api_link: 'https://x.example/yemot?secret=abc',
      api_url_post: 'yes',
      api_call_id_send: 'yes',
    })
    expect(captured).toContain('token=tok-123')
    expect(captured).toContain('path=ivr2%3A%2F1')
    expect(captured).toContain('type=api')
    expect(captured).toContain('api_link=https%3A%2F%2Fx.example%2Fyemot%3Fsecret%3Dabc')
    expect(captured).toContain('api_url_post=yes')
    expect(captured).toContain('api_call_id_send=yes')
  })

  it('getIVR2Dir: returns parsed extIni', async () => {
    nock(BASE)
      .post(PATH + '/GetIVR2Dir')
      .reply(200, {
        responseStatus: 'OK',
        extIni: { type: 'api', api_link: 'https://x/y', title: 'OpenClaw' },
        thisPath: 'ivr2:/1',
        dirs: [],
        files: [],
      })

    const c = new YemotRestClient({ baseUrl: BASE + PATH + '/' })
    const r = await c.getIVR2Dir('tok-123', 'ivr2:/1')
    expect(r.extIni).toEqual({ type: 'api', api_link: 'https://x/y', title: 'OpenClaw' })
  })

  it('getIVR2Dir: throws when responseStatus != OK', async () => {
    nock(BASE)
      .post(PATH + '/GetIVR2Dir')
      .reply(200, { responseStatus: 'NOT_FOUND', message: 'no such path' })

    const c = new YemotRestClient({ baseUrl: BASE + PATH + '/' })
    await expect(c.getIVR2Dir('tok-123', 'ivr2:/99')).rejects.toThrow(/no such path/)
  })

  it('login: surfaces network errors', async () => {
    nock(BASE).post(PATH + '/Login').replyWithError({ code: 'ECONNREFUSED', message: 'refused' })
    const c = new YemotRestClient({ baseUrl: BASE + PATH + '/' })
    await expect(c.login({ username: 'u', password: 'p' })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npx vitest run test/unit/yemot-rest-client.test.ts
```

Expected: fails — module missing.

- [ ] **Step 3: Implement `src/yemot-rest/client.ts` (using node:fetch)**

A direct-fetch implementation gives us full control of the wire format and removes the dep risk. We use `yemot-api` only if it cleanly maps; otherwise fetch is fine. The methods below mirror Yemot's documented contract exactly.

```ts
export interface YemotRestClientOptions {
  baseUrl: string                 // e.g. https://www.call2all.co.il/ym/api/
}

export interface UpdateExtensionFields {
  path: string                    // e.g. "ivr2:/1"
  type?: string                   // "api"
  title?: string
  api_link?: string
  api_url_post?: 'yes' | 'no'
  api_call_id_send?: 'yes' | 'no'
  api_phone_send?: 'yes' | 'no'
  api_did_send?: 'yes' | 'no'
  api_real_did_send?: 'yes' | 'no'
  api_extension_send?: 'yes' | 'no'
  api_time_send?: 'yes' | 'no'
  api_yf_call_id_send?: 'yes' | 'no'
  api_hangup_send?: 'yes' | 'no'
  [k: string]: string | undefined
}

export interface IVR2DirResult {
  extIni: Record<string, string>
  thisPath: string
  dirs: unknown[]
  files: unknown[]
}

export class YemotRestError extends Error {
  constructor(message: string, public readonly responseStatus?: string) {
    super(message)
    this.name = 'YemotRestError'
  }
}

export class YemotRestClient {
  private readonly baseUrl: string

  constructor(opts: YemotRestClientOptions) {
    this.baseUrl = opts.baseUrl.endsWith('/') ? opts.baseUrl : opts.baseUrl + '/'
  }

  async login(creds: { username: string; password: string }): Promise<string> {
    const data = await this.post('Login', {
      username: creds.username,
      password: creds.password,
    })
    if (typeof data.token !== 'string') {
      throw new YemotRestError(`Login: missing token in response`, data.responseStatus)
    }
    return data.token
  }

  async updateExtension(token: string, fields: UpdateExtensionFields): Promise<void> {
    const body: Record<string, string> = { token }
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) body[k] = v
    }
    await this.post('UpdateExtension', body)
  }

  async getIVR2Dir(token: string, path: string): Promise<IVR2DirResult> {
    const data = await this.post('GetIVR2Dir', { token, path })
    return {
      extIni: (data.extIni ?? {}) as Record<string, string>,
      thisPath: typeof data.thisPath === 'string' ? data.thisPath : path,
      dirs: Array.isArray(data.dirs) ? data.dirs : [],
      files: Array.isArray(data.files) ? data.files : [],
    }
  }

  private async post(endpoint: string, body: Record<string, string>): Promise<Record<string, unknown>> {
    const url = this.baseUrl + endpoint
    const formBody = new URLSearchParams(body).toString()
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody,
    })
    if (!res.ok) {
      throw new YemotRestError(`${endpoint}: HTTP ${res.status}`)
    }
    const data = await res.json() as Record<string, unknown>
    const status = data.responseStatus
    if (status !== undefined && status !== 'OK') {
      const msg = typeof data.message === 'string' ? data.message : `responseStatus=${String(status)}`
      throw new YemotRestError(`${endpoint}: ${msg}`, String(status))
    }
    return data
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
npx vitest run test/unit/yemot-rest-client.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/yemot-rest/client.ts test/unit/yemot-rest-client.test.ts
git commit -m "Add Yemot REST client (Login, UpdateExtension, GetIVR2Dir) — TDD with nock"
```

---

## Task 8: Bootstrap flow (idempotent extension setup)

**Files:**
- Create: `src/yemot-rest/bootstrap.ts`
- Test: `test/unit/yemot-rest-bootstrap.test.ts`

The "magic" that makes user setup one-step. On service start it calls `Login → UpdateExtension → GetIVR2Dir` to verify, with retry/backoff and `api_link → api_url` field-name fallback.

- [ ] **Step 1: Write the failing test**

Create `test/unit/yemot-rest-bootstrap.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { bootstrapExtension, BootstrapResult } from '../../src/yemot-rest/bootstrap.js'
import type { YemotRestClient, UpdateExtensionFields, IVR2DirResult } from '../../src/yemot-rest/client.js'

function mkClient(impl: Partial<YemotRestClient>): YemotRestClient {
  return {
    login: vi.fn(),
    updateExtension: vi.fn(),
    getIVR2Dir: vi.fn(),
    ...impl,
  } as unknown as YemotRestClient
}

const baseInput = {
  username: 'u', password: 'p',
  extensionNumber: '1',
  extensionTitle: 'OpenClaw Voice',
  publicBaseUrl: 'https://addin.example.com',
  webhookPath: '/yemot',
  sharedSecret: 'sssssssssssssssss',
}

describe('bootstrapExtension', () => {
  it('happy path: login → updateExtension → getIVR2Dir verifies api_link', async () => {
    const updateExt = vi.fn().mockResolvedValue(undefined)
    const getDir = vi.fn().mockResolvedValue({
      extIni: { type: 'api', api_link: 'https://addin.example.com/yemot?secret=sssssssssssssssss' },
      thisPath: 'ivr2:/1', dirs: [], files: [],
    } satisfies IVR2DirResult)
    const client = mkClient({
      login: vi.fn().mockResolvedValue('tok-1'),
      updateExtension: updateExt,
      getIVR2Dir: getDir,
    })

    const r: BootstrapResult = await bootstrapExtension(client, baseInput)
    expect(r.ok).toBe(true)
    expect(r.resolvedApiLink).toBe('https://addin.example.com/yemot?secret=sssssssssssssssss')
    expect(r.fellBackToApiUrl).toBe(false)

    const passed = updateExt.mock.calls[0][1] as UpdateExtensionFields
    expect(passed.path).toBe('ivr2:/1')
    expect(passed.type).toBe('api')
    expect(passed.api_link).toBe('https://addin.example.com/yemot?secret=sssssssssssssssss')
    expect(passed.api_url_post).toBe('yes')
    expect(passed.api_call_id_send).toBe('yes')
    expect(passed.api_phone_send).toBe('yes')
    expect(passed.api_did_send).toBe('yes')
    expect(passed.api_hangup_send).toBe('yes')
  })

  it('falls back to api_url when api_link missing in read-back', async () => {
    const updateExt = vi.fn().mockResolvedValue(undefined)
    let call = 0
    const getDir = vi.fn().mockImplementation(async () => {
      call++
      if (call === 1) {
        return { extIni: { type: 'api' /* no api_link */ }, thisPath: 'ivr2:/1', dirs: [], files: [] }
      }
      return { extIni: { type: 'api', api_url: 'https://addin.example.com/yemot?secret=sssssssssssssssss' }, thisPath: 'ivr2:/1', dirs: [], files: [] }
    })
    const client = mkClient({
      login: vi.fn().mockResolvedValue('tok-1'),
      updateExtension: updateExt,
      getIVR2Dir: getDir,
    })

    const r = await bootstrapExtension(client, baseInput)
    expect(r.ok).toBe(true)
    expect(r.fellBackToApiUrl).toBe(true)
    expect(r.resolvedApiLink).toBe('https://addin.example.com/yemot?secret=sssssssssssssssss')
    expect(updateExt).toHaveBeenCalledTimes(2)
    const second = updateExt.mock.calls[1][1] as UpdateExtensionFields
    expect(second.api_url).toBe('https://addin.example.com/yemot?secret=sssssssssssssssss')
  })

  it('retries on transient errors with exponential backoff and ultimately fails', async () => {
    const client = mkClient({
      login: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      updateExtension: vi.fn(),
      getIVR2Dir: vi.fn(),
    })

    const r = await bootstrapExtension(client, { ...baseInput, retryDelaysMs: [1, 1, 1, 1, 1] })
    expect(r.ok).toBe(false)
    expect(r.error?.message).toMatch(/ECONNREFUSED/)
    expect(client.login).toHaveBeenCalledTimes(6)   // 1 initial + 5 retries
  })

  it('builds correct webhook URL when publicBaseUrl has trailing slash', async () => {
    const updateExt = vi.fn().mockResolvedValue(undefined)
    const getDir = vi.fn().mockResolvedValue({
      extIni: { type: 'api', api_link: 'https://addin.example.com/yemot?secret=sssssssssssssssss' },
      thisPath: 'ivr2:/1', dirs: [], files: [],
    })
    const client = mkClient({
      login: vi.fn().mockResolvedValue('tok-1'),
      updateExtension: updateExt,
      getIVR2Dir: getDir,
    })
    await bootstrapExtension(client, { ...baseInput, publicBaseUrl: 'https://addin.example.com/' })
    const fields = updateExt.mock.calls[0][1] as UpdateExtensionFields
    // No double slash:
    expect(fields.api_link).toBe('https://addin.example.com/yemot?secret=sssssssssssssssss')
  })

  it('retries are eventually successful: rejects, then resolves on retry', async () => {
    let n = 0
    const client = mkClient({
      login: vi.fn().mockImplementation(async () => {
        n++
        if (n < 3) throw new Error('transient')
        return 'tok-1'
      }),
      updateExtension: vi.fn().mockResolvedValue(undefined),
      getIVR2Dir: vi.fn().mockResolvedValue({
        extIni: { type: 'api', api_link: 'https://addin.example.com/yemot?secret=sssssssssssssssss' },
        thisPath: 'ivr2:/1', dirs: [], files: [],
      }),
    })
    const r = await bootstrapExtension(client, { ...baseInput, retryDelaysMs: [1, 1, 1, 1, 1] })
    expect(r.ok).toBe(true)
    expect(client.login).toHaveBeenCalledTimes(3)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npx vitest run test/unit/yemot-rest-bootstrap.test.ts
```

Expected: fails — module missing.

- [ ] **Step 3: Implement `src/yemot-rest/bootstrap.ts`**

```ts
import type { YemotRestClient, UpdateExtensionFields } from './client.js'

export interface BootstrapInput {
  username: string
  password: string
  extensionNumber: string
  extensionTitle: string
  publicBaseUrl: string         // e.g. https://addin.example.com
  webhookPath: string           // e.g. /yemot
  sharedSecret: string
  retryDelaysMs?: number[]      // default [1000,2000,4000,8000,16000]
}

export interface BootstrapResult {
  ok: boolean
  resolvedApiLink?: string
  fellBackToApiUrl?: boolean
  error?: Error
  attempts: number
}

const DEFAULT_RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000]

export async function bootstrapExtension(
  client: YemotRestClient,
  input: BootstrapInput,
): Promise<BootstrapResult> {
  const delays = input.retryDelaysMs ?? DEFAULT_RETRY_DELAYS
  const webhookUrl = buildWebhookUrl(input.publicBaseUrl, input.webhookPath, input.sharedSecret)
  const path = `ivr2:/${input.extensionNumber}`

  let attempts = 0
  let lastErr: Error | undefined

  for (let i = 0; i <= delays.length; i++) {
    attempts++
    try {
      const token = await client.login({ username: input.username, password: input.password })
      const baseFields: UpdateExtensionFields = {
        path,
        type: 'api',
        title: input.extensionTitle,
        api_link: webhookUrl,
        api_url_post: 'yes',
        api_call_id_send: 'yes',
        api_phone_send: 'yes',
        api_did_send: 'yes',
        api_real_did_send: 'yes',
        api_extension_send: 'yes',
        api_time_send: 'yes',
        api_yf_call_id_send: 'yes',
        api_hangup_send: 'yes',
      }
      await client.updateExtension(token, baseFields)
      const verify = await client.getIVR2Dir(token, path)
      const resolved = verify.extIni.api_link
      if (resolved) {
        return { ok: true, resolvedApiLink: resolved, fellBackToApiUrl: false, attempts }
      }
      // Fallback: retry with api_url= (legacy field name) and re-verify.
      await client.updateExtension(token, { ...baseFields, api_url: webhookUrl })
      const verify2 = await client.getIVR2Dir(token, path)
      const resolved2 = verify2.extIni.api_url ?? verify2.extIni.api_link
      if (resolved2) {
        return { ok: true, resolvedApiLink: resolved2, fellBackToApiUrl: true, attempts }
      }
      throw new Error(
        `Verification: neither api_link nor api_url present after UpdateExtension on ${path}`,
      )
    } catch (e) {
      lastErr = e as Error
      if (i < delays.length) {
        await sleep(delays[i] ?? 0)
      }
    }
  }

  return { ok: false, error: lastErr, attempts }
}

function buildWebhookUrl(base: string, path: string, secret: string): string {
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${cleanBase}${cleanPath}?secret=${encodeURIComponent(secret)}`
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
npx vitest run test/unit/yemot-rest-bootstrap.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/yemot-rest/bootstrap.ts test/unit/yemot-rest-bootstrap.test.ts
git commit -m "Add idempotent extension bootstrap with retry+field-name fallback (TDD)"
```

---

## Task 9: CallSession + SessionRegistry

**Files:**
- Create: `src/call-session.ts`
- Test: `test/unit/call-session.test.ts`

A `CallSession` class wrapping the per-call state shape from `types.ts`, plus a `SessionRegistry` (a typed `Map`) for tracking active calls.

- [ ] **Step 1: Write the failing test**

Create `test/unit/call-session.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { CallSession, SessionRegistry } from '../../src/call-session.js'

describe('CallSession', () => {
  it('initializes with all required fields', () => {
    const s = new CallSession({
      callId: 'YF-1',
      phone: '0521234567',
      did: '0772345678',
      realDid: '0772345678',
      extension: '1',
      language: 'he-IL',
    })
    expect(s.state.callId).toBe('YF-1')
    expect(s.state.phone).toBe('0521234567')
    expect(s.state.transcript).toEqual([])
    expect(s.state.turnCount).toBe(0)
    expect(s.state.consecutiveEmptyInputs).toBe(0)
    expect(s.state.abortController).toBeInstanceOf(AbortController)
    expect(s.state.startedAt).toBeGreaterThan(0)
  })

  it('appendTranscript pushes entries and bumps lastTurnAt', () => {
    const s = new CallSession({
      callId: 'YF-2', phone: 'p', did: 'd', realDid: 'd', extension: '1', language: 'he-IL',
    })
    const before = s.state.lastTurnAt
    s.appendTranscript({ speaker: 'user', text: 'שלום', isFinal: true })
    expect(s.state.transcript).toHaveLength(1)
    expect(s.state.transcript[0]?.speaker).toBe('user')
    expect(s.state.transcript[0]?.ts).toBeGreaterThan(0)
    expect(s.state.lastTurnAt).toBeGreaterThanOrEqual(before)
  })

  it('incTurn / resetEmpty / incEmpty work', () => {
    const s = new CallSession({
      callId: 'YF-3', phone: 'p', did: 'd', realDid: 'd', extension: '1', language: 'he-IL',
    })
    s.incTurn(); s.incTurn()
    expect(s.state.turnCount).toBe(2)
    s.incEmpty(); s.incEmpty()
    expect(s.state.consecutiveEmptyInputs).toBe(2)
    s.resetEmpty()
    expect(s.state.consecutiveEmptyInputs).toBe(0)
  })

  it('abort() signals the abort controller', () => {
    const s = new CallSession({
      callId: 'YF-4', phone: 'p', did: 'd', realDid: 'd', extension: '1', language: 'he-IL',
    })
    expect(s.state.abortController.signal.aborted).toBe(false)
    s.abort('hangup-user')
    expect(s.state.abortController.signal.aborted).toBe(true)
  })
})

describe('SessionRegistry', () => {
  it('add / get / delete work and active count is correct', () => {
    const r = new SessionRegistry()
    expect(r.size()).toBe(0)
    const s1 = new CallSession({ callId: 'A', phone:'1', did:'d', realDid:'d', extension:'1', language:'he-IL' })
    const s2 = new CallSession({ callId: 'B', phone:'2', did:'d', realDid:'d', extension:'1', language:'he-IL' })
    r.add(s1); r.add(s2)
    expect(r.size()).toBe(2)
    expect(r.get('A')).toBe(s1)
    r.delete('A')
    expect(r.get('A')).toBeUndefined()
    expect(r.size()).toBe(1)
  })

  it('list returns shallow copies of all sessions', () => {
    const r = new SessionRegistry()
    r.add(new CallSession({ callId:'A', phone:'1', did:'d', realDid:'d', extension:'1', language:'he-IL' }))
    r.add(new CallSession({ callId:'B', phone:'2', did:'d', realDid:'d', extension:'1', language:'he-IL' }))
    const list = r.list()
    expect(list).toHaveLength(2)
    expect(list.map(s => s.state.callId).sort()).toEqual(['A', 'B'])
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npx vitest run test/unit/call-session.test.ts
```

Expected: fails — module missing.

- [ ] **Step 3: Implement `src/call-session.ts`**

```ts
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
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
npx vitest run test/unit/call-session.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/call-session.ts test/unit/call-session.test.ts
git commit -m "Add CallSession + SessionRegistry (TDD)"
```

---

## Task 10: Agent-loop bridge (timeout, JSON retry, abort)

**Files:**
- Create: `src/agent-loop.ts`
- Test: `test/unit/agent-loop.test.ts`

The bridge between the call coroutine and OpenClaw's `api.runtime.agent.run`. Handles:
- Timeout (`responseTimeoutMs`)
- Strict JSON parse → on failure, 1 retry with corrective system message → on 2nd failure, auto-wrap as plain text
- AbortSignal forwarded from the session
- Empty/null response → coerced to a fallback

We define `AgentRunner` as the dependency interface so we can stub it without depending on OpenClaw types in v1 (Section 12 risk: exact signature unverified).

- [ ] **Step 1: Write the failing test**

Create `test/unit/agent-loop.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { AgentLoop, type AgentRunner, type AgentRunInput } from '../../src/agent-loop.js'
import { CallSession } from '../../src/call-session.js'

const cfg = {
  agentName: 'test-bot',
  systemPromptAddon: 'אתה בוט.',
  responseTimeoutMs: 1000,
  fallbackErrorMessage: 'שגיאה',
}

function mkSession() {
  return new CallSession({
    callId: 'YF-X', phone: '0521', did: '0772', realDid: '0772', extension: '1', language: 'he-IL',
  })
}

describe('AgentLoop.firstTurn', () => {
  it('calls agent runner with agentName, input=__call_started__, context, and returns parsed reply', async () => {
    const runner: AgentRunner = vi.fn().mockResolvedValue('שלום!')
    const loop = new AgentLoop({ runner, cfg })
    const r = await loop.firstTurn(mkSession())
    expect(r).toEqual({ spoken: 'שלום!', mode: 'stt', end: false })
    const arg = (runner as unknown as { mock: { calls: AgentRunInput[][] } }).mock.calls[0][0]
    expect(arg.agentName).toBe('test-bot')
    expect(arg.input).toBe('__call_started__')
    expect(arg.context.channel).toBe('voice-yemot')
    expect(arg.context.callId).toBe('YF-X')
    expect(arg.conversationId).toBe('YF-X')
    expect(arg.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('AgentLoop.nextTurn', () => {
  it('forwards user input', async () => {
    const runner: AgentRunner = vi.fn().mockResolvedValue('בסדר')
    const loop = new AgentLoop({ runner, cfg })
    await loop.nextTurn(mkSession(), 'אני רוצה תור')
    const arg = (runner as unknown as { mock: { calls: AgentRunInput[][] } }).mock.calls[0][0]
    expect(arg.input).toBe('אני רוצה תור')
  })

  it('parses JSON reply with end:true', async () => {
    const runner: AgentRunner = vi.fn().mockResolvedValue('{"spoken":"להתראות","end":true}')
    const loop = new AgentLoop({ runner, cfg })
    const r = await loop.nextTurn(mkSession(), 'תודה')
    expect(r).toEqual({ spoken: 'להתראות', mode: 'stt', end: true })
  })

  it('on timeout, throws AgentTimeoutError', async () => {
    const runner: AgentRunner = () => new Promise(() => { /* hang */ })
    const loop = new AgentLoop({ runner, cfg: { ...cfg, responseTimeoutMs: 50 } })
    await expect(loop.nextTurn(mkSession(), 'x')).rejects.toThrow(/timed out/i)
  })

  it('retries once with corrective prompt when JSON is malformed but starts with {', async () => {
    let n = 0
    const runner: AgentRunner = vi.fn().mockImplementation(async (input: AgentRunInput) => {
      n++
      if (n === 1) return '{not valid'
      // Second call should include the corrective prefix
      expect(input.input).toMatch(/Reply with strict JSON/)
      return '{"spoken":"בסדר","mode":"stt","end":false}'
    })
    const loop = new AgentLoop({ runner, cfg })
    const r = await loop.nextTurn(mkSession(), 'תודה')
    expect(r.spoken).toBe('בסדר')
    expect(n).toBe(2)
  })

  it('after 2 JSON failures, auto-wraps as plain text', async () => {
    let n = 0
    const runner: AgentRunner = vi.fn().mockImplementation(async () => {
      n++
      return '{still bad'
    })
    const loop = new AgentLoop({ runner, cfg })
    const r = await loop.nextTurn(mkSession(), 'x')
    expect(r.spoken).toBe('{still bad')
    expect(r.mode).toBe('stt')
    expect(n).toBe(2)
  })

  it('coerces empty/whitespace agent reply to fallbackErrorMessage', async () => {
    const runner: AgentRunner = vi.fn().mockResolvedValue('   ')
    const loop = new AgentLoop({ runner, cfg })
    const r = await loop.nextTurn(mkSession(), 'x')
    expect(r.spoken).toBe('שגיאה')
  })

  it('forwards AbortSignal from session; aborting the session causes the runner to receive an aborted signal', async () => {
    let receivedSignal: AbortSignal | undefined
    const runner: AgentRunner = vi.fn().mockImplementation(async (input: AgentRunInput) => {
      receivedSignal = input.signal
      return new Promise(resolve => {
        const t = setTimeout(() => resolve('שלום'), 1000)
        input.signal?.addEventListener('abort', () => { clearTimeout(t); resolve('aborted-default') })
      })
    })
    const loop = new AgentLoop({ runner, cfg: { ...cfg, responseTimeoutMs: 5000 } })
    const session = mkSession()
    const promise = loop.nextTurn(session, 'x')
    setTimeout(() => session.abort('hangup-user'), 10)
    const r = await promise
    expect(receivedSignal?.aborted).toBe(true)
    expect(r.spoken).toBe('aborted-default')
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npx vitest run test/unit/agent-loop.test.ts
```

Expected: fails — module missing.

- [ ] **Step 3: Implement `src/agent-loop.ts`**

```ts
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
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
npx vitest run test/unit/agent-loop.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/agent-loop.ts test/unit/agent-loop.test.ts
git commit -m "Add AgentLoop with timeout, JSON retry, AbortSignal forwarding (TDD)"
```

---

## Task 11: Mock Yemot harness (test helper)

**Files:**
- Create: `test/helpers/mock-yemot.ts`
- Create: `test/helpers/stub-agent.ts`
- Test: `test/unit/mock-yemot.test.ts` (sanity: harness emits the right HTTP shape)

The mock harness is a test client that issues the same HTTP requests Yemot would. It accepts a script of "what the user does each turn" and asserts the response directives the addin sends back.

This task ships only the harness (and a small unit test of *the harness itself*). Task 14 uses it for full integration scenarios.

- [ ] **Step 1: Write the harness sanity test**

Create `test/unit/mock-yemot.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'
import { MockYemotCaller } from '../helpers/mock-yemot.js'

describe('MockYemotCaller', () => {
  it('POSTs the expected webhook fields on call start', async () => {
    let received: Record<string, string> | undefined
    const app = express()
    app.use(express.urlencoded({ extended: true }))
    app.post('/yemot', (req, res) => {
      received = req.body
      res.type('text').send('id_list_message=t-bye&go_to_folder=hangup')
    })
    const server = app.listen(0)
    await new Promise(r => server.on('listening', r))
    const port = (server.address() as AddressInfo).port

    const caller = new MockYemotCaller(`http://127.0.0.1:${port}/yemot`, {
      ApiCallId: 'YF-T-1',
      ApiPhone: '0521234567',
      ApiDID: '0772345678',
      ApiRealDID: '0772345678',
      ApiExtension: '1',
      ApiTime: '1746104400',
      ApiYFCallId: 'YF-T-1',
    }, 'sssssssssssssssss')

    const log = await caller.simulateCall([{ hangup: true }])
    expect(received?.ApiCallId).toBe('YF-T-1')
    expect(received?.ApiPhone).toBe('0521234567')
    expect(log[0]?.response).toContain('id_list_message=t-bye')

    server.close()
  })

  it('on a multi-turn script, accumulates val_n in subsequent requests', async () => {
    const seen: Array<Record<string, string>> = []
    const app = express()
    app.use(express.urlencoded({ extended: true }))
    let callN = 0
    app.post('/yemot', (req, res) => {
      seen.push(req.body)
      callN++
      if (callN === 1) return res.type('text').send('read=t-greeting=val_1,no,voice,he-IL')
      if (callN === 2) return res.type('text').send('read=t-next=val_2,no,voice,he-IL')
      res.type('text').send('id_list_message=t-bye&go_to_folder=hangup')
    })
    const server = app.listen(0)
    await new Promise(r => server.on('listening', r))
    const port = (server.address() as AddressInfo).port

    const caller = new MockYemotCaller(`http://127.0.0.1:${port}/yemot`, {
      ApiCallId: 'YF-T-2', ApiPhone: 'p', ApiDID: 'd', ApiRealDID: 'd',
      ApiExtension: '1', ApiTime: '0', ApiYFCallId: 'YF-T-2',
    }, 'sssssssssssssssss')

    await caller.simulateCall([
      { input: { val_1: 'hello' } },
      { input: { val_2: 'world' } },
      { hangup: true },
    ])

    expect(seen[0]?.val_1).toBeUndefined()
    expect(seen[1]?.val_1).toBe('hello')
    expect(seen[2]?.val_1).toBe('hello')
    expect(seen[2]?.val_2).toBe('world')

    server.close()
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npx vitest run test/unit/mock-yemot.test.ts
```

Expected: fails — helper missing.

- [ ] **Step 3: Implement `test/helpers/mock-yemot.ts`**

```ts
export interface YemotBaseParams {
  ApiCallId: string
  ApiPhone: string
  ApiDID: string
  ApiRealDID: string
  ApiExtension: string
  ApiTime: string
  ApiYFCallId: string
}

export type Turn =
  | { input: Record<string, string> }
  | { hangup: true }

export interface TurnLog {
  request: Record<string, string>
  response: string
}

export class MockYemotCaller {
  private accumulatedValues: Record<string, string> = {}

  constructor(
    private readonly endpointUrl: string,        // e.g. http://127.0.0.1:1234/yemot
    private readonly base: YemotBaseParams,
    private readonly secret: string,
  ) {}

  async simulateCall(script: Turn[]): Promise<TurnLog[]> {
    const log: TurnLog[] = []
    // Turn 0: initial webhook (no val_*)
    let response = await this.send({})
    log.push({ request: this.lastRequestBody!, response })

    for (const turn of script) {
      if ('hangup' in turn) {
        const finalResp = await this.send({ hangup: 'yes', ApiHangupExtension: '/' + this.base.ApiExtension })
        log.push({ request: this.lastRequestBody!, response: finalResp })
        break
      }
      // Add the user-input fields to the running accumulation
      for (const [k, v] of Object.entries(turn.input)) {
        this.accumulatedValues[k] = v
      }
      response = await this.send(turn.input)
      log.push({ request: this.lastRequestBody!, response })
    }

    return log
  }

  private lastRequestBody?: Record<string, string>

  private async send(extra: Record<string, string>): Promise<string> {
    const body: Record<string, string> = {
      ...this.base,
      ...this.accumulatedValues,
      ...extra,
    }
    this.lastRequestBody = body

    const url = this.endpointUrl + (this.endpointUrl.includes('?') ? '&' : '?') + 'secret=' + encodeURIComponent(this.secret)
    const formBody = new URLSearchParams(body).toString()
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody,
    })
    if (!res.ok) {
      throw new Error(`MockYemotCaller: HTTP ${res.status} from ${url}`)
    }
    return await res.text()
  }
}
```

- [ ] **Step 4: Implement `test/helpers/stub-agent.ts`**

```ts
import type { AgentRunInput, AgentRunner } from '../../src/agent-loop.js'

/**
 * Build a deterministic agent runner from a sequence of canned replies.
 * Each call to the runner pops the next reply from the queue.
 * Throws if the queue is exhausted (test must add enough replies).
 */
export function stubAgent(...replies: string[]): AgentRunner {
  const queue = [...replies]
  return async (_input: AgentRunInput): Promise<string> => {
    if (queue.length === 0) {
      throw new Error('stubAgent: no more canned replies (queue exhausted)')
    }
    return queue.shift()!
  }
}
```

- [ ] **Step 5: Run the harness sanity test, verify it passes**

```bash
npx vitest run test/unit/mock-yemot.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add test/helpers/mock-yemot.ts test/helpers/stub-agent.ts test/unit/mock-yemot.test.ts
git commit -m "Add Mock Yemot harness for integration tests (TDD)"
```

---

## Task 12: Router-bridge (the call coroutine)

**Files:**
- Create: `src/router-bridge.ts`
- Test: `test/unit/router-bridge.test.ts`

Wires `yemot-router2`'s handler to `AgentLoop` and `SessionRegistry`. The handler is a pure function of its dependencies — testable by passing in a fake `Call` object.

This is the most logic-heavy unit. We test it with a manually constructed `FakeCall` so we don't need the real `yemot-router2` instance here; full integration tests come in Task 14.

- [ ] **Step 1: Write the failing test**

Create `test/unit/router-bridge.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { buildCallHandler } from '../../src/router-bridge.js'
import { SessionRegistry } from '../../src/call-session.js'
import { AgentLoop } from '../../src/agent-loop.js'
import { stubAgent } from '../helpers/stub-agent.js'
import type { NormalizedEvent } from '../../src/events.js'

interface FakeCallInit {
  ApiCallId: string
  inputs: string[]                      // each await call.read returns the next entry
  hangupAfter?: number                  // 0 = before turn 0; 1 = after turn 0; etc.
}

class ExitError extends Error {
  constructor() { super('Exit'); this.name = 'ExitError' }
}

function fakeCall(init: FakeCallInit): {
  call: any                              // the fake Call object passed to the handler
  events: { read: number; idList: number; hangup: number }
  responses: { directive: string; mode: string }[]
} {
  const events = { read: 0, idList: 0, hangup: 0 }
  const responses: { directive: string; mode: string }[] = []
  let inputIdx = 0
  let exited = false
  const call = {
    ApiCallId: init.ApiCallId,
    callId: init.ApiCallId,
    phone: '0521234567',
    did: '0772345678',
    real_did: '0772345678',
    extension: '1',
    ApiPhone: '0521234567',
    ApiDID: '0772345678',
    ApiRealDID: '0772345678',
    ApiExtension: '1',

    async read(messages: { type: string; data: string }[], mode: string, _opts?: unknown): Promise<string> {
      events.read++
      responses.push({ directive: messages.map(m => m.data).join('|'), mode })
      if (init.hangupAfter !== undefined && events.read > init.hangupAfter) {
        // Simulate caller hangup mid-read by throwing a tagged error;
        // the handler treats it as a normal exit.
        exited = true
        throw new ExitError()
      }
      const input = init.inputs[inputIdx++]
      if (input === undefined) {
        throw new Error('FakeCall: out of inputs')
      }
      return input
    },

    id_list_message(messages: { type: string; data: string }[], _opts?: unknown): never {
      events.idList++
      responses.push({ directive: messages.map(m => m.data).join('|'), mode: 'id_list' })
      exited = true
      throw new ExitError()
    },

    hangup(): never {
      events.hangup++
      throw new ExitError()
    },
  }
  return { call, events, responses }
}

const baseCfg = {
  agentName: 'test-bot',
  systemPromptAddon: 'אתה בוט.',
  responseTimeoutMs: 1000,
  fallbackErrorMessage: 'שגיאה',
}

describe('buildCallHandler', () => {
  it('runs the greet→listen→reply→end flow and emits events', async () => {
    const events: NormalizedEvent[] = []
    const registry = new SessionRegistry()
    const agentLoop = new AgentLoop({
      runner: stubAgent('שלום!', '{"spoken":"להתראות","end":true}'),
      cfg: baseCfg,
    })
    const handler = buildCallHandler({
      registry,
      agentLoop,
      cfg: { defaultMode: 'stt', sttQuietMaxSec: 3, sttMaxLengthSec: 30, language: 'he-IL', removeInvalidTtsChars: true, fallbackErrorMessage: 'שגיאה', maxTurnsPerCall: 50 },
      emit: e => events.push(e),
    })

    const { call, events: callEvents, responses } = fakeCall({
      ApiCallId: 'YF-1', inputs: ['אני רוצה תור'],
    })

    await handler(call as any).catch(e => {
      if (e?.name !== 'ExitError') throw e
    })

    // Two prompts emitted: greeting then goodbye
    expect(callEvents.read).toBe(1)
    expect(callEvents.idList).toBe(1)
    expect(responses[0]?.directive).toBe('שלום!')
    expect(responses[1]?.directive).toBe('להתראות')

    const types = events.map(e => e.type)
    expect(types).toContain('call.initiated')
    expect(types).toContain('call.speaking')
    expect(types).toContain('call.speech')
    expect(types).toContain('call.ended')

    expect(registry.size()).toBe(0)
  })

  it('on caller hangup, emits call.ended with reason hangup-user', async () => {
    const events: NormalizedEvent[] = []
    const registry = new SessionRegistry()
    const agentLoop = new AgentLoop({
      runner: stubAgent('שלום!'),
      cfg: baseCfg,
    })
    const handler = buildCallHandler({
      registry, agentLoop,
      cfg: { defaultMode: 'stt', sttQuietMaxSec: 3, sttMaxLengthSec: 30, language: 'he-IL', removeInvalidTtsChars: true, fallbackErrorMessage: 'שגיאה', maxTurnsPerCall: 50 },
      emit: e => events.push(e),
    })

    const { call } = fakeCall({ ApiCallId: 'YF-2', inputs: [], hangupAfter: 1 })

    await handler(call as any).catch(e => {
      if (e?.name !== 'ExitError') throw e
    })

    const ended = events.find(e => e.type === 'call.ended')
    expect(ended).toBeDefined()
    if (ended?.type === 'call.ended') {
      expect(ended.reason).toBe('hangup-user')
    }
  })

  it('on agent error, plays fallback and ends with reason error', async () => {
    const events: NormalizedEvent[] = []
    const registry = new SessionRegistry()
    const failingRunner = vi.fn().mockRejectedValue(new Error('boom'))
    const agentLoop = new AgentLoop({ runner: failingRunner, cfg: baseCfg })
    const handler = buildCallHandler({
      registry, agentLoop,
      cfg: { defaultMode: 'stt', sttQuietMaxSec: 3, sttMaxLengthSec: 30, language: 'he-IL', removeInvalidTtsChars: true, fallbackErrorMessage: 'שגיאה', maxTurnsPerCall: 50 },
      emit: e => events.push(e),
    })

    const { call, responses } = fakeCall({ ApiCallId: 'YF-3', inputs: [] })
    await handler(call as any).catch(e => {
      if (e?.name !== 'ExitError') throw e
    })

    expect(responses.find(r => r.mode === 'id_list')?.directive).toBe('שגיאה')
    const ended = events.find(e => e.type === 'call.ended')
    if (ended?.type === 'call.ended') {
      expect(ended.reason).toBe('error')
    }
  })

  it('switches mode to tap when agent reply has mode:tap', async () => {
    const events: NormalizedEvent[] = []
    const registry = new SessionRegistry()
    const agentLoop = new AgentLoop({
      runner: stubAgent(
        '{"spoken":"בחר","mode":"tap","tap":{"digits":["1","2"],"maxDigits":1,"timeoutSec":5}}',
        '{"spoken":"תודה","end":true}',
      ),
      cfg: baseCfg,
    })
    const handler = buildCallHandler({
      registry, agentLoop,
      cfg: { defaultMode: 'stt', sttQuietMaxSec: 3, sttMaxLengthSec: 30, language: 'he-IL', removeInvalidTtsChars: true, fallbackErrorMessage: 'שגיאה', maxTurnsPerCall: 50 },
      emit: e => events.push(e),
    })
    const { call, responses } = fakeCall({ ApiCallId: 'YF-4', inputs: ['1'] })
    await handler(call as any).catch(e => {
      if (e?.name !== 'ExitError') throw e
    })
    expect(responses[0]?.mode).toBe('tap')
    const dtmf = events.find(e => e.type === 'call.dtmf')
    expect(dtmf).toBeDefined()
  })

  it('terminates with max-turns when agent never sets end:true', async () => {
    const events: NormalizedEvent[] = []
    const registry = new SessionRegistry()
    // 100 non-ending replies — agent loop will be invoked too many times, max-turns kicks in
    const agentLoop = new AgentLoop({
      runner: stubAgent(...new Array(100).fill('keep going')),
      cfg: baseCfg,
    })
    const handler = buildCallHandler({
      registry, agentLoop,
      cfg: { defaultMode: 'stt', sttQuietMaxSec: 3, sttMaxLengthSec: 30, language: 'he-IL', removeInvalidTtsChars: true, fallbackErrorMessage: 'שגיאה', maxTurnsPerCall: 3 },
      emit: e => events.push(e),
    })
    const { call } = fakeCall({ ApiCallId: 'YF-5', inputs: new Array(50).fill('still talking') })
    await handler(call as any).catch(e => {
      if (e?.name !== 'ExitError') throw e
    })
    const ended = events.find(e => e.type === 'call.ended')
    if (ended?.type === 'call.ended') {
      expect(ended.reason).toBe('max-turns')
    }
  })

  it('counts consecutive empty inputs and ends after 2 with idle-timeout', async () => {
    const events: NormalizedEvent[] = []
    const registry = new SessionRegistry()
    const agentLoop = new AgentLoop({
      runner: stubAgent('שלום!', 'נסה שוב', 'נסה שוב'),
      cfg: baseCfg,
    })
    const handler = buildCallHandler({
      registry, agentLoop,
      cfg: { defaultMode: 'stt', sttQuietMaxSec: 3, sttMaxLengthSec: 30, language: 'he-IL', removeInvalidTtsChars: true, fallbackErrorMessage: 'שגיאה', maxTurnsPerCall: 50 },
      emit: e => events.push(e),
    })
    const { call } = fakeCall({ ApiCallId: 'YF-6', inputs: ['', ''] })
    await handler(call as any).catch(e => {
      if (e?.name !== 'ExitError') throw e
    })
    const ended = events.find(e => e.type === 'call.ended')
    if (ended?.type === 'call.ended') {
      expect(ended.reason).toBe('idle-timeout')
    }
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npx vitest run test/unit/router-bridge.test.ts
```

Expected: fails — module missing.

- [ ] **Step 3: Implement `src/router-bridge.ts`**

```ts
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
    let nextPrompt
    try {
      nextPrompt = await agentLoop.firstTurn(session)
      session.appendTranscript({ speaker: 'bot', text: nextPrompt.spoken, isFinal: true })
      emit({ type: 'call.speaking', session: session.state, text: nextPrompt.spoken })

      while (true) {
        if (nextPrompt.end) {
          call.id_list_message(renderPromptDirective(nextPrompt.spoken, { stripInvalidChars: cfg.removeInvalidTtsChars }))
          // never reached (id_list_message throws)
          break
        }

        const userInput = await call.read(
          renderPromptDirective(nextPrompt.spoken, { stripInvalidChars: cfg.removeInvalidTtsChars }),
          nextPrompt.mode,
          modeOptions(nextPrompt, cfg),
        )

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
  return {
    lang: cfg.language,
    quiet_max: cfg.sttQuietMaxSec,
    max_length: cfg.sttMaxLengthSec,
  }
}

function isExitError(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'name' in e && (e as { name: unknown }).name === 'ExitError'
}
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
npx vitest run test/unit/router-bridge.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/router-bridge.ts test/unit/router-bridge.test.ts
git commit -m "Add router-bridge call handler (greet, loop, end-detection, error, idle, max-turns)"
```

---

## Task 13: YemotService (Express + router lifecycle)

**Files:**
- Create: `src/service.ts`
- Create: `src/logging.ts`
- Test: `test/unit/service.test.ts`

The service owns the Express server, mounts `yemot-router2`, runs bootstrap on start, and shuts down gracefully. We test start/stop and the `disableAuth` path with an ephemeral port.

**Caveat to implementer:** the exact API for OpenClaw's `api.registerService` (fields it expects on a service object: `start()`, `stop()`, `name`, `state()` etc.) was not pinned during research. Implement the service so it has standalone `start()`, `stop()`, `state()`, `endCall(callId)` methods. Wiring those to whatever shape `registerService` expects happens in Task 17 with a small adapter.

- [ ] **Step 1: Write `src/logging.ts` (pass-through stub)**

```ts
export interface PluginLogger {
  debug(msg: string, ctx?: Record<string, unknown>): void
  info(msg: string, ctx?: Record<string, unknown>): void
  warn(msg: string, ctx?: Record<string, unknown>): void
  error(msg: string, ctx?: Record<string, unknown>): void
}

export const consoleLogger: PluginLogger = {
  debug(msg, ctx) { console.debug(`[voice-yemot] ${msg}`, ctx ?? '') },
  info(msg, ctx)  { console.info (`[voice-yemot] ${msg}`, ctx ?? '') },
  warn(msg, ctx)  { console.warn (`[voice-yemot] ${msg}`, ctx ?? '') },
  error(msg, ctx) { console.error(`[voice-yemot] ${msg}`, ctx ?? '') },
}

/**
 * Wrap an OpenClaw `api.logger` (whose exact shape is plugin-API-version-dependent)
 * into the addin's PluginLogger interface. If passed undefined, returns consoleLogger.
 */
export function wrapHostLogger(host: unknown): PluginLogger {
  if (host && typeof host === 'object' && 'info' in host && 'error' in host) {
    return host as PluginLogger
  }
  return consoleLogger
}
```

- [ ] **Step 2: Write the failing service test**

Create `test/unit/service.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { YemotService } from '../../src/service.js'
import { stubAgent } from '../helpers/stub-agent.js'
import type { PluginConfig } from '../../src/types.js'

function mkCfg(port: number, overrides: Partial<PluginConfig> = {}): PluginConfig {
  const base: PluginConfig = {
    yemot: {
      systemNumber: '0772345678', username: 'u', password: 'p',
      extensionNumber: '1', extensionTitle: 'Test',
      apiBaseUrl: 'https://example.invalid/ym/api/',
      language: 'he-IL', removeInvalidTtsChars: true,
      autoConfigureExtension: false,    // skip bootstrap in unit tests
    },
    server: {
      port, host: '127.0.0.1', webhookPath: '/yemot',
      publicBaseUrl: `http://127.0.0.1:${port}`,
      sharedSecret: 'sssssssssssssssss',
      disableAuth: false,
    },
    agent: {
      name: 'test-bot',
      systemPromptAddon: '',
      responseTimeoutMs: 1000,
      maxTurnsPerCall: 10,
    },
    call: {
      defaultMode: 'stt', sttQuietMaxSec: 3, sttMaxLengthSec: 30,
      callIdleTimeoutSec: 60, fallbackErrorMessage: 'שגיאה',
    },
    persistence: { transcripts: false, logDir: './var' },
    ...overrides,
  }
  return base
}

describe('YemotService', () => {
  it('start opens the listening socket on the configured port', async () => {
    const svc = new YemotService({
      cfg: mkCfg(0),                  // 0 = ephemeral
      runner: stubAgent('hi'),
    })
    await svc.start()
    expect(svc.state().listening).toBe(true)
    expect(svc.state().port).toBeGreaterThan(0)
    await svc.stop()
    expect(svc.state().listening).toBe(false)
  })

  it('rejects 403 on missing secret', async () => {
    const svc = new YemotService({
      cfg: mkCfg(0),
      runner: stubAgent('hi', '{"spoken":"bye","end":true}'),
    })
    await svc.start()
    const port = svc.state().port
    const res = await fetch(`http://127.0.0.1:${port}/yemot`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'ApiCallId=X',
    })
    expect(res.status).toBe(403)
    await svc.stop()
  })

  it('endCall(callId) marks an in-flight session for hangup', async () => {
    const svc = new YemotService({
      cfg: mkCfg(0),
      runner: stubAgent('hi'),
    })
    await svc.start()
    // No active call; endCall should return false (or {ok:false}).
    expect(svc.endCall('NONEXISTENT')).toBe(false)
    await svc.stop()
  })

  it('disableAuth: true permits unauthenticated webhooks', async () => {
    const svc = new YemotService({
      cfg: mkCfg(0, { server: { ...mkCfg(0).server, disableAuth: true, sharedSecret: '' } }),
      runner: stubAgent('hi', '{"spoken":"bye","end":true}'),
    })
    await svc.start()
    const port = svc.state().port
    const res = await fetch(`http://127.0.0.1:${port}/yemot`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ApiCallId: 'YF-1', ApiPhone: 'p', ApiDID: 'd', ApiRealDID: 'd',
        ApiExtension: '1', ApiTime: '0', ApiYFCallId: 'YF-1',
      }).toString(),
    })
    // Webhook accepted (status 200); body is the directive (read=...).
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toMatch(/^read=t-/)
    await svc.stop()
  })
})
```

- [ ] **Step 3: Run the test, verify it fails**

```bash
npx vitest run test/unit/service.test.ts
```

Expected: fails — module missing.

- [ ] **Step 4: Implement `src/service.ts`**

```ts
import express from 'express'
import type { Server } from 'node:http'
import { YemotRouter } from 'yemot-router2'
import { createAuthMiddleware } from './auth.js'
import { SessionRegistry } from './call-session.js'
import { AgentLoop, type AgentRunner } from './agent-loop.js'
import { buildCallHandler } from './router-bridge.js'
import type { NormalizedEvent } from './events.js'
import type { PluginConfig } from './types.js'
import { wrapHostLogger, type PluginLogger } from './logging.js'

export interface ServiceState {
  listening: boolean
  port: number
  baseUrl: string
  activeCallCount: number
  version: string
  bootstrapStatus: 'pending' | 'ok' | 'failed' | 'skipped'
  bootstrapError?: string
  lastAuthFailureAt?: number
}

export interface YemotServiceOptions {
  cfg: PluginConfig
  runner: AgentRunner
  logger?: PluginLogger
  onEvent?: (e: NormalizedEvent) => void
}

const VERSION = '0.1.0'

export class YemotService {
  private app = express()
  private server?: Server
  private actualPort = 0
  private listening = false
  private bootstrapStatus: ServiceState['bootstrapStatus'] = 'pending'
  private bootstrapError?: string
  private lastAuthFailureAt?: number

  private registry = new SessionRegistry()
  private agentLoop: AgentLoop
  private logger: PluginLogger

  constructor(private readonly opts: YemotServiceOptions) {
    this.logger = wrapHostLogger(opts.logger)
    this.agentLoop = new AgentLoop({
      runner: opts.runner,
      cfg: {
        agentName: opts.cfg.agent.name,
        systemPromptAddon: opts.cfg.agent.systemPromptAddon,
        responseTimeoutMs: opts.cfg.agent.responseTimeoutMs,
        fallbackErrorMessage: opts.cfg.call.fallbackErrorMessage,
      },
    })
  }

  async start(): Promise<void> {
    this.app.use(express.urlencoded({ extended: true }))
    this.app.use(this.opts.cfg.server.webhookPath, createAuthMiddleware({
      sharedSecret: this.opts.cfg.server.sharedSecret,
      disableAuth: this.opts.cfg.server.disableAuth,
      onAuthFailure: info => {
        this.lastAuthFailureAt = Date.now()
        this.opts.onEvent?.({ type: 'auth.failed', remoteIp: info.remoteIp, reason: info.reason })
        this.logger.warn('webhook auth failed', info)
      },
    }))

    const router = YemotRouter({
      timeout: 60_000,
      printLog: false,
      removeInvalidChars: this.opts.cfg.yemot.removeInvalidTtsChars,
    })

    const handler = buildCallHandler({
      registry: this.registry,
      agentLoop: this.agentLoop,
      cfg: {
        defaultMode: this.opts.cfg.call.defaultMode,
        sttQuietMaxSec: this.opts.cfg.call.sttQuietMaxSec,
        sttMaxLengthSec: this.opts.cfg.call.sttMaxLengthSec,
        language: this.opts.cfg.yemot.language,
        removeInvalidTtsChars: this.opts.cfg.yemot.removeInvalidTtsChars,
        fallbackErrorMessage: this.opts.cfg.call.fallbackErrorMessage,
        maxTurnsPerCall: this.opts.cfg.agent.maxTurnsPerCall,
      },
      emit: e => this.opts.onEvent?.(e),
    })

    router.all('/', handler as unknown as Parameters<typeof router.all>[1])

    this.app.use(this.opts.cfg.server.webhookPath, router as unknown as express.RequestHandler)

    await new Promise<void>((resolve, reject) => {
      this.server = this.app.listen(this.opts.cfg.server.port, this.opts.cfg.server.host, () => {
        this.actualPort = (this.server!.address() as { port: number }).port
        this.listening = true
        this.logger.info('yemot service listening', { port: this.actualPort, baseUrl: this.opts.cfg.server.publicBaseUrl })
        resolve()
      })
      this.server!.on('error', reject)
    })

    if (this.opts.cfg.yemot.autoConfigureExtension) {
      this.bootstrapStatus = 'pending'
      // Lazy import to keep bootstrap off the unit-test path when auto-configure is off
      const { bootstrapExtension } = await import('./yemot-rest/bootstrap.js')
      const { YemotRestClient } = await import('./yemot-rest/client.js')
      const client = new YemotRestClient({ baseUrl: this.opts.cfg.yemot.apiBaseUrl })
      const r = await bootstrapExtension(client, {
        username: this.opts.cfg.yemot.username,
        password: this.opts.cfg.yemot.password,
        extensionNumber: this.opts.cfg.yemot.extensionNumber,
        extensionTitle: this.opts.cfg.yemot.extensionTitle,
        publicBaseUrl: this.opts.cfg.server.publicBaseUrl,
        webhookPath: this.opts.cfg.server.webhookPath,
        sharedSecret: this.opts.cfg.server.sharedSecret,
      })
      if (r.ok) {
        this.bootstrapStatus = 'ok'
        this.logger.info('extension bootstrapped', { apiLink: r.resolvedApiLink, fellBackToApiUrl: r.fellBackToApiUrl })
        this.opts.onEvent?.({
          type: 'extension.configured',
          apiLink: r.resolvedApiLink!,
          extensionNumber: this.opts.cfg.yemot.extensionNumber,
        })
      } else {
        this.bootstrapStatus = 'failed'
        this.bootstrapError = r.error?.message
        this.logger.error('extension bootstrap failed', { error: r.error?.message, attempts: r.attempts })
      }
    } else {
      this.bootstrapStatus = 'skipped'
    }
  }

  async stop(): Promise<void> {
    if (!this.server) return
    // For each active session, signal abort so in-flight agent calls terminate.
    for (const s of this.registry.list()) {
      s.abort('shutdown')
    }
    await new Promise<void>(resolve => {
      this.server!.close(() => resolve())
      // Give it 30s; close() callback fires once all connections drain.
      setTimeout(resolve, 30_000)
    })
    this.listening = false
    this.server = undefined
  }

  state(): ServiceState {
    return {
      listening: this.listening,
      port: this.actualPort,
      baseUrl: this.opts.cfg.server.publicBaseUrl,
      activeCallCount: this.registry.size(),
      version: VERSION,
      bootstrapStatus: this.bootstrapStatus,
      bootstrapError: this.bootstrapError,
      lastAuthFailureAt: this.lastAuthFailureAt,
    }
  }

  list(): Array<{ callId: string; phone: string; did: string; startedAt: number; lastTurnAt: number; transcriptLength: number }> {
    return this.registry.list().map(s => ({
      callId: s.state.callId,
      phone: s.state.phone,
      did: s.state.did,
      startedAt: s.state.startedAt,
      lastTurnAt: s.state.lastTurnAt,
      transcriptLength: s.state.transcript.length,
    }))
  }

  endCall(callId: string): boolean {
    const s = this.registry.get(callId)
    if (!s) return false
    s.abort('manual')
    return true
  }
}
```

- [ ] **Step 5: Run the service test**

```bash
npx vitest run test/unit/service.test.ts
```

Expected: 4 tests pass. If `yemot-router2`'s actual export name isn't `YemotRouter`, fix the import to whatever the lib exposes (`router`, `default`, etc.) — the README in the linked repo will state the correct binding.

- [ ] **Step 6: Commit**

```bash
git add src/service.ts src/logging.ts test/unit/service.test.ts
git commit -m "Add YemotService (Express + yemot-router2 + bootstrap on start) — TDD"
```

---

## Task 14: Integration tests with mock harness

**Files:**
- Create: `test/integration/full-call-flows.test.ts`

End-to-end scenarios from the spec §9.2: run the real `YemotService` against the `MockYemotCaller`, assert directives + emitted events.

- [ ] **Step 1: Write the integration tests**

Create `test/integration/full-call-flows.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { YemotService } from '../../src/service.js'
import { stubAgent } from '../helpers/stub-agent.js'
import { MockYemotCaller } from '../helpers/mock-yemot.js'
import type { PluginConfig } from '../../src/types.js'
import type { NormalizedEvent } from '../../src/events.js'

function baseCfg(): PluginConfig {
  return {
    yemot: {
      systemNumber: '0772345678', username: 'u', password: 'p',
      extensionNumber: '1', extensionTitle: 'Test',
      apiBaseUrl: 'https://example.invalid/ym/api/',
      language: 'he-IL', removeInvalidTtsChars: true,
      autoConfigureExtension: false,
    },
    server: {
      port: 0, host: '127.0.0.1', webhookPath: '/yemot',
      publicBaseUrl: '',                       // filled in after start
      sharedSecret: 'sssssssssssssssss',
      disableAuth: false,
    },
    agent: { name: 'bot', systemPromptAddon: '', responseTimeoutMs: 5000, maxTurnsPerCall: 50 },
    call: { defaultMode: 'stt', sttQuietMaxSec: 3, sttMaxLengthSec: 30, callIdleTimeoutSec: 60, fallbackErrorMessage: 'שגיאה' },
    persistence: { transcripts: false, logDir: './var' },
  }
}

interface Spawned {
  svc: YemotService
  caller: (callId: string) => MockYemotCaller
  events: NormalizedEvent[]
  endpoint: string
}

async function spawn(cfgOverrides: Partial<PluginConfig> = {}, runnerReplies: string[] = []): Promise<Spawned> {
  const events: NormalizedEvent[] = []
  const cfg = { ...baseCfg(), ...cfgOverrides }
  const svc = new YemotService({
    cfg,
    runner: stubAgent(...runnerReplies),
    onEvent: e => events.push(e),
  })
  await svc.start()
  const port = svc.state().port
  const endpoint = `http://127.0.0.1:${port}/yemot`
  const caller = (callId: string) => new MockYemotCaller(endpoint, {
    ApiCallId: callId, ApiPhone: '0521234567', ApiDID: '0772345678', ApiRealDID: '0772345678',
    ApiExtension: '1', ApiTime: String(Math.floor(Date.now() / 1000)), ApiYFCallId: callId,
  }, cfg.server.sharedSecret)
  return { svc, caller, events, endpoint }
}

describe('full-call flows', () => {
  let spawned: Spawned | undefined
  afterEach(async () => { await spawned?.svc.stop(); spawned = undefined })

  it('greets, takes one user turn, ends the call', async () => {
    spawned = await spawn({}, ['שלום!', '{"spoken":"להתראות","end":true}'])
    const log = await spawned.caller('YF-1').simulateCall([
      { input: { val_1: 'אני רוצה תור' } },
    ])
    expect(log[0]?.response).toMatch(/^read=t-/)
    expect(log[0]?.response).toContain('שלום!')
    expect(log[1]?.response).toMatch(/^id_list_message=t-/)
    expect(log[1]?.response).toContain('להתראות')
  })

  it('multi-turn (5 turns) all stt mode', async () => {
    spawned = await spawn({}, [
      'שלום, איך אפשר לעזור?',
      'מה השם שלך?',
      'נעים מאוד',
      'איפה אתה גר?',
      'תודה רבה',
      '{"spoken":"להתראות","end":true}',
    ])
    const log = await spawned.caller('YF-2').simulateCall([
      { input: { val_1: 'בוקר טוב' } },
      { input: { val_2: 'יוסי' } },
      { input: { val_3: 'בסדר' } },
      { input: { val_4: 'תל אביב' } },
      { input: { val_5: 'בבקשה' } },
    ])
    expect(log).toHaveLength(6)            // 5 reads + 1 id_list_message
    expect(log[5]?.response).toMatch(/^id_list_message=t-/)
  })

  it('mid-call switch from stt to tap', async () => {
    spawned = await spawn({}, [
      'שלום',
      '{"spoken":"בחר 1, 2, או 3","mode":"tap","tap":{"digits":["1","2","3"],"maxDigits":1,"timeoutSec":5}}',
      '{"spoken":"בחירתך התקבלה","end":true}',
    ])
    const log = await spawned.caller('YF-3').simulateCall([
      { input: { val_1: 'מה האפשרויות?' } },
      { input: { val_2: '2' } },
    ])
    // Second prompt should be a tap-mode read
    const r2 = log[1]?.response ?? ''
    // tap mode in yemot-router2 yields a read directive without ",voice," — its third slot is digit count
    expect(r2).toMatch(/^read=/)
    expect(r2).not.toContain(',voice,')
    const dtmf = spawned.events.find(e => e.type === 'call.dtmf')
    expect(dtmf).toBeDefined()
  })

  it('caller hangs up mid-conversation', async () => {
    spawned = await spawn({}, ['שלום!', 'מה?', 'מה?'])
    await spawned.caller('YF-4').simulateCall([
      { input: { val_1: 'אהמ' } },
      { hangup: true },
    ])
    const ended = spawned.events.find(e => e.type === 'call.ended')
    expect(ended).toBeDefined()
  })

  it('two consecutive empty inputs: addin gives up gracefully (idle-timeout)', async () => {
    spawned = await spawn({}, ['שלום!', 'נסה שוב', 'נסה שוב'])
    const log = await spawned.caller('YF-5').simulateCall([
      { input: { val_1: '' } },
      { input: { val_2: '' } },
    ])
    expect(log[log.length - 1]?.response).toMatch(/^id_list_message=t-/)
    const ended = spawned.events.find(e => e.type === 'call.ended')
    if (ended?.type === 'call.ended') {
      expect(ended.reason).toBe('idle-timeout')
    }
  })

  it('agent throws → fallback message played, reason=error', async () => {
    const events: NormalizedEvent[] = []
    const svc = new YemotService({
      cfg: baseCfg(),
      runner: async () => { throw new Error('boom') },
      onEvent: e => events.push(e),
    })
    await svc.start()
    const caller = new MockYemotCaller(
      `http://127.0.0.1:${svc.state().port}/yemot`,
      { ApiCallId: 'YF-6', ApiPhone:'p', ApiDID:'d', ApiRealDID:'d', ApiExtension:'1', ApiTime:'0', ApiYFCallId:'YF-6' },
      baseCfg().server.sharedSecret,
    )
    const log = await caller.simulateCall([{ hangup: true }])
    expect(log[0]?.response).toMatch(/^id_list_message=t-/)
    expect(log[0]?.response).toContain('שגיאה')
    const ended = events.find(e => e.type === 'call.ended')
    if (ended?.type === 'call.ended') {
      expect(ended.reason).toBe('error')
    }
    await svc.stop()
  })

  it('agent times out → fallback played', async () => {
    const cfg = baseCfg()
    cfg.agent.responseTimeoutMs = 50
    const svc = new YemotService({
      cfg,
      runner: () => new Promise(() => { /* hang forever */ }),
    })
    await svc.start()
    const caller = new MockYemotCaller(
      `http://127.0.0.1:${svc.state().port}/yemot`,
      { ApiCallId: 'YF-7', ApiPhone:'p', ApiDID:'d', ApiRealDID:'d', ApiExtension:'1', ApiTime:'0', ApiYFCallId:'YF-7' },
      cfg.server.sharedSecret,
    )
    const log = await caller.simulateCall([{ hangup: true }])
    expect(log[0]?.response).toContain('שגיאה')
    await svc.stop()
  })

  it('agent malformed JSON twice → auto-wrap as plain text', async () => {
    spawned = await spawn({}, [
      '{not valid',           // 1st: malformed
      '{still bad',           // 2nd: corrective retry also malformed
      '{"spoken":"ok bye","end":true}',
    ])
    const log = await spawned.caller('YF-8').simulateCall([
      { input: { val_1: 'hi' } },
    ])
    // First prompt is the auto-wrapped plain-text "{not valid"
    expect(log[0]?.response).toContain('{still bad')
    expect(log[1]?.response).toMatch(/^id_list_message/)
  })

  it('wrong secret → 403, no session created', async () => {
    spawned = await spawn({}, ['שלום!'])
    const res = await fetch(spawned.endpoint + '?secret=wrong', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ApiCallId: 'YF-9', ApiPhone:'p', ApiDID:'d', ApiRealDID:'d', ApiExtension:'1', ApiTime:'0', ApiYFCallId:'YF-9',
      }).toString(),
    })
    expect(res.status).toBe(403)
    expect(spawned.events.find(e => e.type === 'call.initiated')).toBeUndefined()
    expect(spawned.events.find(e => e.type === 'auth.failed')).toBeDefined()
  })

  it('three concurrent calls — sessions isolated', async () => {
    spawned = await spawn({}, [
      'שלום A', '{"spoken":"bye A","end":true}',
      'שלום B', '{"spoken":"bye B","end":true}',
      'שלום C', '{"spoken":"bye C","end":true}',
    ])
    const [logA, logB, logC] = await Promise.all([
      spawned.caller('YF-A').simulateCall([{ input: { val_1: 'a-said' } }]),
      spawned.caller('YF-B').simulateCall([{ input: { val_1: 'b-said' } }]),
      spawned.caller('YF-C').simulateCall([{ input: { val_1: 'c-said' } }]),
    ])
    // Each call's final id_list_message reflects the right reply
    expect(logA[1]?.response).toContain('bye')
    expect(logB[1]?.response).toContain('bye')
    expect(logC[1]?.response).toContain('bye')
    // No transcript bleed: the three sessions ended cleanly
    expect(spawned.events.filter(e => e.type === 'call.ended')).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run integration tests**

```bash
npx vitest run test/integration/full-call-flows.test.ts
```

Expected: 10 tests pass. Some may need minor tweaks based on `yemot-router2`'s actual directive wire-format (e.g. exact comma-positions in `read=`); adjust regex assertions to match what the library produces. The structural assertions (event types, endings, count of turns) should pass without protocol-level adjustment.

- [ ] **Step 3: Commit**

```bash
git add test/integration/full-call-flows.test.ts
git commit -m "Add integration test scenarios via mock Yemot harness"
```

---

## Task 15: Gateway methods (status / list / end)

**Files:**
- Create: `src/gateway-methods.ts`
- Test: `test/unit/gateway-methods.test.ts`

Exposes three RPC-shaped functions an OpenClaw caller (CLI, dashboard) can invoke against this addin.

- [ ] **Step 1: Write the failing test**

Create `test/unit/gateway-methods.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { buildGatewayMethods } from '../../src/gateway-methods.js'
import type { YemotService } from '../../src/service.js'

function mkService(stub: Partial<YemotService>): YemotService {
  return {
    state: vi.fn().mockReturnValue({
      listening: true, port: 4080, baseUrl: 'https://x', activeCallCount: 0,
      version: '0.1.0', bootstrapStatus: 'ok',
    }),
    list: vi.fn().mockReturnValue([]),
    endCall: vi.fn().mockReturnValue(false),
    ...stub,
  } as unknown as YemotService
}

describe('gateway methods', () => {
  it('status returns the service.state() payload', () => {
    const svc = mkService({})
    const m = buildGatewayMethods(svc)
    const r = m.status({})
    expect(r.listening).toBe(true)
    expect(r.port).toBe(4080)
    expect(r.version).toBe('0.1.0')
  })

  it('list returns the active calls', () => {
    const svc = mkService({
      list: vi.fn().mockReturnValue([
        { callId: 'A', phone: 'p', did: 'd', startedAt: 1, lastTurnAt: 2, transcriptLength: 3 },
      ]),
    })
    const r = buildGatewayMethods(svc).list({})
    expect(r).toHaveLength(1)
    expect(r[0]?.callId).toBe('A')
  })

  it('end returns ok=true when call existed', () => {
    const svc = mkService({ endCall: vi.fn().mockReturnValue(true) })
    const r = buildGatewayMethods(svc).end({ callId: 'X' })
    expect(r.ok).toBe(true)
  })

  it('end returns ok=false when call did not exist', () => {
    const svc = mkService({ endCall: vi.fn().mockReturnValue(false) })
    const r = buildGatewayMethods(svc).end({ callId: 'NOPE' })
    expect(r.ok).toBe(false)
  })

  it('end throws when callId is missing', () => {
    const svc = mkService({})
    expect(() => buildGatewayMethods(svc).end({} as { callId: string })).toThrow(/callId/i)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npx vitest run test/unit/gateway-methods.test.ts
```

Expected: fails — module missing.

- [ ] **Step 3: Implement `src/gateway-methods.ts`**

```ts
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
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
npx vitest run test/unit/gateway-methods.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/gateway-methods.ts test/unit/gateway-methods.test.ts
git commit -m "Add gateway methods (status / list / end) — TDD"
```

---

## Task 16: OpenClaw plugin manifest

**Files:**
- Create: `openclaw.plugin.json`

The manifest declares the config schema, UI hints, env-var mappings, and secrets paths. This is what the OpenClaw config UI reads to render the form for the user. No tests — declarative.

- [ ] **Step 1: Write `openclaw.plugin.json`**

```json
{
  "id": "voice-yemot",
  "name": "Voice (Yemot Hamashiach)",
  "description": "Inbound voice channel for Yemot Hamashiach (Israeli IVR provider). Hebrew menu-driven IVR with LLM reasoning per turn.",
  "version": "0.1.0",
  "license": "MIT",
  "homepage": "https://github.com/sivanratson/openclaw-voice-yemot",
  "compat": { "pluginApi": "^1.0.0" },
  "install": { "minHostVersion": "0.1.0" },
  "release": { "publishToClawHub": false, "publishToNpm": false },
  "activation": {
    "onStartup": true
  },
  "channelEnvVars": {
    "YEMOT_USERNAME": "yemot.username",
    "YEMOT_PASSWORD": "yemot.password",
    "YEMOT_SYSTEM_NUMBER": "yemot.systemNumber",
    "YEMOT_EXTENSION_NUMBER": "yemot.extensionNumber",
    "VOICE_YEMOT_PUBLIC_URL": "server.publicBaseUrl",
    "VOICE_YEMOT_SHARED_SECRET": "server.sharedSecret",
    "VOICE_YEMOT_PORT": "server.port",
    "VOICE_YEMOT_AGENT": "agent.name"
  },
  "configContracts": {
    "secretInputs": {
      "paths": ["yemot.password", "server.sharedSecret"]
    }
  },
  "configSchema": {
    "type": "object",
    "required": ["yemot", "agent", "server"],
    "properties": {
      "yemot": {
        "type": "object",
        "required": ["systemNumber", "username", "password", "extensionNumber"],
        "properties": {
          "systemNumber":     { "type": "string", "pattern": "^[0-9]+$" },
          "username":         { "type": "string" },
          "password":         { "type": "string" },
          "extensionNumber":  { "type": "string", "default": "1" },
          "extensionTitle":   { "type": "string", "default": "OpenClaw Voice" },
          "apiBaseUrl":       { "type": "string", "format": "uri", "default": "https://www.call2all.co.il/ym/api/" },
          "language":         { "type": "string", "default": "he-IL" },
          "removeInvalidTtsChars":  { "type": "boolean", "default": true },
          "autoConfigureExtension": { "type": "boolean", "default": true }
        }
      },
      "server": {
        "type": "object",
        "properties": {
          "port":          { "type": "integer", "default": 4080 },
          "host":          { "type": "string",  "default": "0.0.0.0" },
          "webhookPath":   { "type": "string",  "default": "/yemot" },
          "publicBaseUrl": { "type": "string",  "format": "uri" },
          "sharedSecret":  { "type": "string",  "minLength": 16 },
          "disableAuth":   { "type": "boolean", "default": false }
        }
      },
      "agent": {
        "type": "object",
        "required": ["name"],
        "properties": {
          "name": { "type": "string" },
          "systemPromptAddon": {
            "type": "string",
            "default": "אתה מדבר בשיחה טלפונית בעברית. ענה בקצרה (משפט-שניים), בטון אנושי. כדי לסיים את השיחה, החזר JSON עם end:true."
          },
          "responseTimeoutMs": { "type": "integer", "default": 12000 },
          "maxTurnsPerCall":   { "type": "integer", "default": 50 }
        }
      },
      "call": {
        "type": "object",
        "properties": {
          "defaultMode":          { "enum": ["stt", "tap"], "default": "stt" },
          "sttQuietMaxSec":       { "type": "integer", "default": 3 },
          "sttMaxLengthSec":      { "type": "integer", "default": 30 },
          "callIdleTimeoutSec":   { "type": "integer", "default": 300 },
          "fallbackErrorMessage": { "type": "string", "default": "מצטערים, התרחשה תקלה. נסו שוב מאוחר יותר." }
        }
      },
      "persistence": {
        "type": "object",
        "properties": {
          "transcripts": { "type": "boolean", "default": false },
          "logDir":      { "type": "string",  "default": "./var/voice-yemot" }
        }
      }
    }
  },
  "uiHints": {
    "yemot.systemNumber":  { "label": "Yemot system number" },
    "yemot.username":      { "label": "Yemot username" },
    "yemot.password":      { "label": "Yemot password", "sensitive": true },
    "yemot.extensionNumber": { "label": "Extension to wire (e.g. 1)" },
    "yemot.extensionTitle":  { "label": "Extension title", "advanced": true },
    "yemot.apiBaseUrl":      { "label": "Yemot REST API base URL", "advanced": true },
    "yemot.language":        { "label": "Language code (BCP-47)", "advanced": true },
    "yemot.removeInvalidTtsChars":  { "label": "Strip invalid TTS chars", "advanced": true },
    "yemot.autoConfigureExtension": { "label": "Auto-configure Yemot extension on start" },

    "server.port":          { "label": "Local listen port" },
    "server.host":          { "label": "Local bind host", "advanced": true },
    "server.webhookPath":   { "label": "Webhook path", "advanced": true },
    "server.publicBaseUrl": { "label": "Public base URL Yemot calls (https://...)", "help": "If running locally, use ngrok or another tunnel and put the public URL here." },
    "server.sharedSecret":  { "label": "Shared webhook secret", "sensitive": true, "help": "Auto-generated if blank — but keep one to identify your addin." },
    "server.disableAuth":   { "label": "DISABLE webhook auth (NOT recommended)", "advanced": true },

    "agent.name":              { "label": "Bound OpenClaw agent name" },
    "agent.systemPromptAddon": { "label": "System prompt addon for voice", "advanced": true },
    "agent.responseTimeoutMs": { "label": "Agent reply timeout (ms)", "advanced": true },
    "agent.maxTurnsPerCall":   { "label": "Max turns per call", "advanced": true },

    "call.defaultMode":           { "label": "Default IVR mode", "advanced": true },
    "call.sttQuietMaxSec":        { "label": "STT silence cutoff (sec)", "advanced": true },
    "call.sttMaxLengthSec":       { "label": "STT max utterance length (sec)", "advanced": true },
    "call.callIdleTimeoutSec":    { "label": "Per-call idle timeout (sec)", "advanced": true },
    "call.fallbackErrorMessage":  { "label": "Fallback message on errors", "advanced": true },

    "persistence.transcripts": { "label": "Persist transcripts to log dir", "advanced": true },
    "persistence.logDir":      { "label": "Log directory", "advanced": true }
  }
}
```

- [ ] **Step 2: Validate the JSON parses**

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('openclaw.plugin.json','utf8')).id)"
```

Expected: prints `voice-yemot`.

- [ ] **Step 3: Commit**

```bash
git add openclaw.plugin.json
git commit -m "Add OpenClaw plugin manifest (config schema, uiHints, env vars, secrets)"
```

---

## Task 17: Plugin entry (definePluginEntry default export)

**Files:**
- Create: `index.ts`

The default export is the plugin's entrypoint. `register(api)` reads validated config, builds the service, registers it as a long-lived component, and exposes the gateway methods.

**Important caveat to the implementer:** the exact import path for `definePluginEntry`, the shape of `OpenClawPluginApi`, and the names of `api.registerService` / `api.registerGatewayMethod` were not pinned during research. **In Task 17 step 1, read the OpenClaw SDK as installed under `node_modules/@openclaw/plugin-sdk/` (or wherever the user has it locally) and confirm the actual symbol names.** If you cannot find an installed SDK during local development, the entry below uses placeholder typing (`any` cast on `api`) so it can ship; before publishing, swap the cast for the real types.

- [ ] **Step 1: Locate the OpenClaw plugin SDK**

```bash
find node_modules -maxdepth 4 -type d -name 'plugin-sdk' 2>/dev/null
find node_modules -maxdepth 4 -type d -name 'openclaw*' 2>/dev/null
```

If results: read the `index.d.ts` of the plugin-sdk to confirm the names of `definePluginEntry`, `OpenClawPluginApi`, `registerService`, `registerGatewayMethod`. Adjust imports below to match. If no results: proceed with the placeholder; the project will need the host's SDK at install time.

- [ ] **Step 2: Write `index.ts`**

```ts
import { YemotService } from './src/service.js'
import { buildGatewayMethods } from './src/gateway-methods.js'
import type { PluginConfig } from './src/types.js'

/**
 * OpenClaw plugin SDK shapes — UNVERIFIED against an installed SDK at the time
 * of writing. Replace with the real types from `@openclaw/plugin-sdk`
 * (or whatever the SDK's package name is) once present.
 */
type OpenClawPluginApi = {
  config: PluginConfig
  logger?: { info: (m: string, c?: unknown) => void; warn: (m: string, c?: unknown) => void; error: (m: string, c?: unknown) => void; debug: (m: string, c?: unknown) => void }
  runtime: {
    agent: {
      run: (input: {
        agentName: string
        input: string
        context: unknown
        conversationId: string
        signal?: AbortSignal
      }) => Promise<string>
    }
  }
  registerService: (service: { name?: string; start(): Promise<void>; stop(): Promise<void> }) => void
  registerGatewayMethod: <Args, Result>(name: string, handler: (args: Args) => Result | Promise<Result>) => void
}

interface DefinePluginEntryArgs {
  id: string
  name: string
  description: string
  register: (api: OpenClawPluginApi) => void
}

declare function definePluginEntry(args: DefinePluginEntryArgs): unknown

// Resolve definePluginEntry from the host. We accept multiple possible paths
// the SDK may expose. The `as any` is intentional during scaffolding;
// once the SDK is pinned, replace with a static import.
async function resolveDefiner(): Promise<(a: DefinePluginEntryArgs) => unknown> {
  const candidates = [
    '@openclaw/plugin-sdk/plugin-entry',
    '@openclaw/plugin-sdk',
    'openclaw/plugin-sdk',
  ]
  for (const c of candidates) {
    try {
      const mod = await import(c) as Record<string, unknown>
      if (typeof mod.definePluginEntry === 'function') {
        return mod.definePluginEntry as (a: DefinePluginEntryArgs) => unknown
      }
      if (typeof mod.default === 'function') {
        return mod.default as (a: DefinePluginEntryArgs) => unknown
      }
    } catch { /* try next */ }
  }
  // Last-resort placeholder (development without the host SDK present).
  // Returns the args so tests can still import this file.
  return (a: DefinePluginEntryArgs) => a
}

const definer = await resolveDefiner()

export default definer({
  id: 'voice-yemot',
  name: 'Voice (Yemot Hamashiach)',
  description: 'Inbound voice channel for Yemot Hamashiach',
  register(api: OpenClawPluginApi) {
    const cfg = api.config
    const service = new YemotService({
      cfg,
      logger: api.logger,
      runner: ({ agentName, input, context, conversationId, signal }) =>
        api.runtime.agent.run({ agentName, input, context, conversationId, signal }),
      onEvent: (e) => {
        // For v1 we only log; future tiers can wire to api.events.emit if available.
        api.logger?.debug('voice-yemot event', { type: e.type })
      },
    })

    api.registerService({
      name: 'voice-yemot',
      start: () => service.start(),
      stop: () => service.stop(),
    })

    const gw = buildGatewayMethods(service)
    api.registerGatewayMethod('voiceyemot.status', gw.status)
    api.registerGatewayMethod('voiceyemot.list',   gw.list)
    api.registerGatewayMethod('voiceyemot.end',    gw.end)
  },
})
```

- [ ] **Step 3: Verify it typechecks and builds**

```bash
npm run typecheck
npm run build
```

Expected: both pass. The placeholder `resolveDefiner` will silence missing-SDK errors during local dev.

- [ ] **Step 4: Run the entire test suite**

```bash
npm test
```

Expected: every test passes (carries forward all green from Tasks 4-15).

- [ ] **Step 5: Commit**

```bash
git add index.ts
git commit -m "Add plugin entry (definePluginEntry, registerService, gateway methods)"
```

---

## Task 18: Smoke script + README

**Files:**
- Create: `scripts/smoke.ts`
- Create: `README.md`

`smoke.ts` is a CLI tool that exercises the bootstrap end-to-end against a real Yemot account. README documents setup, env vars, and the manual call test.

- [ ] **Step 1: Write `scripts/smoke.ts`**

```ts
#!/usr/bin/env tsx
/**
 * Smoke test — exercises Login + UpdateExtension + GetIVR2Dir against the real
 * Yemot REST API. Run before tagging a release.
 *
 * Reads from environment:
 *   YEMOT_USERNAME, YEMOT_PASSWORD, YEMOT_SYSTEM_NUMBER (informational),
 *   YEMOT_EXTENSION_NUMBER (default '1'),
 *   VOICE_YEMOT_PUBLIC_URL (required), VOICE_YEMOT_SHARED_SECRET (required)
 *
 *   YEMOT_API_BASE_URL (optional override, default https://www.call2all.co.il/ym/api/)
 */

import { YemotRestClient } from '../src/yemot-rest/client.js'
import { bootstrapExtension } from '../src/yemot-rest/bootstrap.js'

function need(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing env var: ${name}`)
    process.exit(2)
  }
  return v
}

async function main(): Promise<void> {
  const baseUrl = process.env.YEMOT_API_BASE_URL ?? 'https://www.call2all.co.il/ym/api/'
  const client = new YemotRestClient({ baseUrl })

  const r = await bootstrapExtension(client, {
    username:        need('YEMOT_USERNAME'),
    password:        need('YEMOT_PASSWORD'),
    extensionNumber: process.env.YEMOT_EXTENSION_NUMBER ?? '1',
    extensionTitle:  'OpenClaw Voice (smoke)',
    publicBaseUrl:   need('VOICE_YEMOT_PUBLIC_URL'),
    webhookPath:     '/yemot',
    sharedSecret:    need('VOICE_YEMOT_SHARED_SECRET'),
  })

  if (r.ok) {
    console.log('SMOKE: OK')
    console.log('  apiLink (resolved): ' + r.resolvedApiLink)
    console.log('  fellBackToApiUrl:   ' + (r.fellBackToApiUrl ?? false))
    console.log('  attempts:           ' + r.attempts)
    process.exit(0)
  }
  console.error('SMOKE: FAIL')
  console.error('  attempts: ' + r.attempts)
  console.error('  error:    ' + r.error?.message)
  process.exit(1)
}

main().catch(e => { console.error('SMOKE: UNEXPECTED ERROR', e); process.exit(1) })
```

- [ ] **Step 2: Write `README.md`**

````markdown
# openclaw-voice-yemot

OpenClaw voice-channel addin for Yemot Hamashiach (ימות המשיח), the Israeli IVR provider.

Hebrew menu-driven IVR backed by an LLM agent. Each turn: agent text → Yemot's
built-in Hebrew TTS → caller speaks or presses keys → Yemot's built-in ASR/DTMF →
next agent turn.

## Why & limits

- Yemot's API is **strictly turn-based HTTP webhook** — no realtime audio
  streaming. v1 supports menu-driven flows (~0.5–1.5s per turn). For
  conversational AI with sub-second barge-in, use a Twilio-based addin instead.
- v1 is **inbound calls only**. Outbound campaigns are a future tier.

## Install

```bash
npm install openclaw-voice-yemot
```

(Or, in OpenClaw: `openclaw plugins install github:sivanratson/openclaw-voice-yemot`.)

## Setup

Set these environment variables:

| Var | Meaning |
|---|---|
| `YEMOT_USERNAME` | Yemot account username |
| `YEMOT_PASSWORD` | Yemot account password |
| `YEMOT_SYSTEM_NUMBER` | The Yemot phone number (informational) |
| `YEMOT_EXTENSION_NUMBER` | Extension to wire (default `1`) |
| `VOICE_YEMOT_PUBLIC_URL` | Publicly-reachable HTTPS base URL Yemot calls (e.g. `https://addin.example.com`) |
| `VOICE_YEMOT_SHARED_SECRET` | A long random string; Yemot will pass it as `?secret=` and the addin verifies |
| `VOICE_YEMOT_AGENT` | Name of the OpenClaw agent to bind |

Restart the OpenClaw Gateway. The addin will auto-configure your Yemot extension
to point at its webhook on first start. No manual Yemot admin step is required.

## Local development

```bash
git clone https://github.com/sivanratson/openclaw-voice-yemot
cd openclaw-voice-yemot
npm install
npm test                    # unit + integration tests against the mock Yemot harness
npm run typecheck
npm run build
```

To smoke-test against your real Yemot account:

```bash
export YEMOT_USERNAME=...
export YEMOT_PASSWORD=...
export VOICE_YEMOT_PUBLIC_URL=https://your-tunnel.example.com
export VOICE_YEMOT_SHARED_SECRET=$(openssl rand -hex 16)
npm run smoke
```

Expected output: `SMOKE: OK` plus the resolved `api_link` value.

Then dial your Yemot number; you should hear the agent's greeting.

## Agent reply contract

The agent's text reply is parsed as either:

- **Plain text** — auto-wrapped to `{"spoken": <text>, "mode": "stt", "end": false}`
- **Strict JSON** —
  ```json
  {
    "spoken": "מה תרצה?",
    "mode":   "stt" | "tap",
    "tap":    { "digits": ["1","2"], "maxDigits": 1, "timeoutSec": 5 },
    "end":    false
  }
  ```
  Use `end: true` to play the message and then hang up.
  Use `mode: "tap"` for DTMF capture.

## Gateway methods

- `voiceyemot.status` → `{ listening, port, baseUrl, activeCallCount, version, bootstrapStatus }`
- `voiceyemot.list` → list of active calls
- `voiceyemot.end` `{ callId }` → mark a call for hangup

## License

MIT
````

- [ ] **Step 3: Make sure the smoke script runs (against a deliberately-bad endpoint to assert it fails fast, no real creds yet)**

```bash
YEMOT_USERNAME=u YEMOT_PASSWORD=p VOICE_YEMOT_PUBLIC_URL=https://x VOICE_YEMOT_SHARED_SECRET=ssssssssssssssss YEMOT_API_BASE_URL=https://invalid.invalid/ym/api/ npm run smoke
```

Expected: `SMOKE: FAIL` with a network error after retries. (Real-credentials smoke is left for the user to run manually with their actual Yemot account.)

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke.ts README.md
git commit -m "Add smoke script and README (user setup, agent contract, gateway methods)"
```

---

## Final verification

- [ ] **Step 1: Full build + typecheck + test**

```bash
npm run typecheck && npm run lint && npm run build && npm test
```

Expected: all green. Lint warnings on `any` are acceptable in `index.ts` (placeholder until SDK is pinned); other modules should have zero warnings.

- [ ] **Step 2: Inventory the repo**

```bash
git ls-files
git log --oneline
```

Expected: ~14 source files, ~9 test files, ~7 manifest/config files; ~18-20 commits with meaningful messages.

- [ ] **Step 3: Tag v0.1.0**

```bash
git tag v0.1.0
```

(Tag, do not push — pushing is the user's call.)

- [ ] **Step 4: Final commit if anything changed during verification**

If any drift was found and fixed:
```bash
git add -A
git commit -m "Final verification fixes for v0.1.0"
```

---

## Risks / known compromises in v1 (track for follow-up)

1. **OpenClaw plugin SDK types in `index.ts`** are placeholder casts. Replace with real types once the SDK is installed alongside the addin.
2. **`yemot-router2` directive wire-format** — integration tests assert directive structure with regex. If the library's exact format differs (e.g. comma counts in `read=`), tests may need minor regex adjustments. Behavior assertions (event types, exit reasons) should not need adjustment.
3. **`call.idleTimeout`** is implemented as the "2 consecutive empties" heuristic; `cfg.call.callIdleTimeoutSec` (configured but currently unenforced as wall-clock) is informational in v1. Wire to a real interval check in v1.1 if user feedback warrants.
4. **`AbortSignal` cooperation** with `api.runtime.agent.run` is assumed; if the host doesn't honor it, the in-flight reply is wasted on caller hangup — log a metric and consider a follow-up.
