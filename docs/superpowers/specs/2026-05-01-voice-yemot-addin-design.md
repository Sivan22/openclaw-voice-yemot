# OpenClaw Voice Channel Addin for Yemot Hamashiach — Design

**Status:** Approved by user (brainstorming session, 2026-05-01)
**Author:** Claude (Opus 4.7) with sivan.ratson@gmail.com
**Package:** `openclaw-voice-yemot`
**Repo:** local at `/root/yemot-ivr-openclaw-addin/`, ships as a public git repo
**Scope:** v1, Tier 1 (inbound calls only)

---

## 1. Overview

This addin lets [OpenClaw](https://github.com/openclaw/openclaw) agents handle inbound phone calls
on the Israeli IVR provider **Yemot Hamashiach** (ימות המשיח) using its
[API module](https://f2.freeivr.co.il/topic/56/) and
[REST API](https://f2.freeivr.co.il/topic/55/), via the
[`yemot-router2`](https://github.com/ShlomoCode/yemot-router2) Node.js library
on the inbound side and [`MusiCode1/yemot-api`](https://github.com/MusiCode1/yemot-api)
on the REST side.

It is implemented as a **standalone OpenClaw plugin** that runs its own webhook server,
mirrors the data shapes of the bundled `voice-call` extension (`CallSession`,
`NormalizedEvent`, `TranscriptEntry`), and wires user transcripts/DTMF into
`api.runtime.agent` text-in/text-out — the same agent-runtime contract that
`voice-call` uses. Setup for an end user is essentially: set 4 config fields, restart;
the addin auto-configures the Yemot extension via the REST API.

---

## 2. Goals & non-goals

### Goals (v1, Tier 1)

- Inbound Hebrew menu-driven IVR with LLM-powered reasoning per turn
- Per turn: agent text → Yemot's built-in Hebrew TTS → caller speaks/presses → Yemot
  built-in ASR or DTMF → next agent turn
- One-step setup: user provides Yemot credentials, system number, public URL, agent name;
  addin auto-configures the Yemot extension's `api_link` and metadata-send flags
- Mirrors `voice-call`'s data shapes for future graduation to a registered-provider model
  if/when OpenClaw exposes a `registerVoiceCallProvider` API
- Mock Yemot harness in the test suite for deterministic CI
- Full TypeScript, ESM, vitest

### Non-goals (v1)

- Outbound calls (Yemot campaigns) — Tier 2, future
- Mid-call **transfer** to real phone numbers or other Yemot systems — Tier 3
- **Recording capture** of caller audio (record + REST download + external transcription) — Tier 3
- External TTS (OpenAI / ElevenLabs) — abstraction seam in place; backend deferred
- SMS, fax, credit-card flows, hold queues, music-on-hold — Tier 4, indefinite
- Real-time bidirectional audio streaming — **architecturally infeasible** on Yemot's
  HTTP-webhook protocol; would require SIP/RTP exposure that Yemot does not provide

### Anti-goals

- Forking or upstreaming to `openclaw/openclaw`'s `voice-call` extension
- Inventing a parallel "voice channel" SDK
- Trying to fit Yemot's turn-based protocol into voice-call's `VoiceCallProvider` interface
  (would render `startListening`/`stopListening`, audio modes, and TwiML semantics meaningless)

---

## 3. Glossary

| Term | Meaning |
|---|---|
| **Yemot** / **Yemot Hamashiach** | Israeli telephony / IVR provider (ימות המשיח). Core protocol is HTTP webhook per IVR turn, not SIP/RTP. |
| **API module** (מודול API) | Yemot extension type whose behavior is delegated to a remote HTTP webhook (`type=api`, `api_link=https://...`). |
| **Extension** / **שלוחה** | A folder in Yemot's virtual filesystem; each has an `ext.ini` describing its type and behavior. |
| **REST API** | Separate endpoint family at `https://www.call2all.co.il/ym/api/` for admin/control (login, file upload, extension update, campaigns). |
| **`ApiCallId`** | Yemot's per-call session identifier; constant across all turns of a call. |
| **Turn** | One IVR cycle: Yemot HTTP-calls our webhook, we respond with a directive (e.g. `read=t-...=...`), Yemot performs the action, calls again. |
| **Directive** | The plain-text response language Yemot expects (`read=`, `id_list_message=`, `go_to_folder=`, etc.). |
| **`yemot-router2`** | Node.js library that turns Yemot's webhook protocol into an `async (call) => { await call.read(...) }` coroutine. |
| **OpenClaw** | Open-source AI agent platform; this addin is a plugin for its Gateway process. |
| **`voice-call`** | OpenClaw's bundled voice-channel extension. Supports Twilio/Telnyx/Plivo/Mock. We do NOT extend it; we ship parallel. |
| **`api.runtime.agent`** | OpenClaw's agent-runtime entrypoint — the addin's only contract with agent reasoning. |
| **`stt` mode** | Yemot `read=...,voice` directive — built-in turn-based ASR, default `he-IL`. |
| **`tap` mode** | Yemot `read=...,tap` directive — DTMF capture. |

---

## 4. Background — research findings (condensed)

### 4.1 OpenClaw's voice-call architecture (relevant constraints)

- Plugins are TypeScript ESM modules loaded by the Gateway process via `definePluginEntry`.
  No hot-reload of plugin runtime code; Gateway restart required after install.
- The bundled `voice-call` extension at `extensions/voice-call/` defines a
  `VoiceCallProvider` interface in `src/providers/base.ts` and switches across
  `twilio | telnyx | plivo | mock` providers in `src/runtime.ts`'s `resolveProvider()`.
- **There is no public registration API for new voice carriers.** Providers are hardcoded.
  Adding Yemot to voice-call would require either forking the repo or upstreaming a PR.
- Voice-call's three audio modes (TwiML/`<Say>`, `streaming.enabled`, `realtime.enabled`)
  all assume realtime/turn-of-frame audio access. Only the first (text → carrier TTS)
  has an analog on Yemot.
- The agent-runtime contract is **text-in / text-out**. Voice-call hands the user transcript
  to `api.runtime.agent`, gets text back, plays it. We use the same contract.
- Normalized events used by voice-call's `CallManager`: `call.initiated`, `call.ringing`,
  `call.answered`, `call.active`, `call.speaking`, `call.speech`, `call.silence`,
  `call.dtmf`, `call.ended`, `call.error`. We mirror this vocabulary.

### 4.2 Yemot's protocol (relevant constraints)

- API module is **strictly turn-based HTTP webhook**. No WebSocket, no SIP/RTP, no streaming
  ASR, no realtime audio of any kind.
- Per-turn latency: 0.3–1.5s realistic.
- Built-in Hebrew TTS via `t-<utf8 text>` directive token (chars `."'-&|` forbidden).
- Built-in turn-based ASR via `read=...,voice,he-IL,...` (`stt` mode).
- DTMF via `read=...,tap,...`.
- Recording via `read=...,record,...` (file path returned in next webhook; download via REST).
- All `val_<n>` collected fields are echoed back on every subsequent turn — Yemot itself
  preserves user inputs across the call.
- `ApiCallId` is the session key.

### 4.3 Yemot REST API (admin automation)

Two REST calls fully automate extension setup:

```
POST Login           username=&password=          → token (30-min idle TTL)
POST UpdateExtension token=&path=ivr2:/<extNum>
                     &type=api
                     &title=<title>
                     &api_link=<webhookUrl>?secret=<sharedSecret>
                     &api_url_post=yes
                     &api_call_id_send=yes
                     &api_phone_send=yes
                     &api_did_send=yes
                     &api_real_did_send=yes
                     &api_extension_send=yes
                     &api_time_send=yes
                     &api_yf_call_id_send=yes
                     &api_hangup_send=yes
                                                  → 200, ext.ini merged
POST GetIVR2Dir      token=&path=ivr2:/<extNum>   → assert extIni.api_link matches
```

`UpdateExtension` is **idempotent** and **merges** fields (does not wipe). The canonical
field name for the webhook URL is **`api_link`**, not `api_url`. Send-flags default to `no`,
so they must be explicitly enabled.

### 4.4 `yemot-router2` library

- Mounts as Express sub-router; tracks active calls by `ApiCallId` in `activeCalls` map.
- Handler is `async (call) => { ... }`; each `await call.read(...)` is a single HTTP turn,
  with the coroutine suspended between Yemot webhooks.
- Methods: `read(messages, mode, options)`, `id_list_message(messages, opts)`,
  `go_to_folder(target)`, `routing_yemot(num)`, `restart_ext()`, `hangup()`,
  `blockRunningUntilNextRequest()`, `send(rawDirective)`.
- `id_list_message` and `go_to_folder` throw an internal `ExitError` to terminate the handler.
- Events on `router.events`: `new_call`, `call_continue`, `call_hangup`.
- `removeInvalidChars: true` strips Yemot's TTS-forbidden characters.

---

## 5. Architecture

### 5.1 Plugin lifecycle

```
index.ts default export = definePluginEntry({
  id: 'voice-yemot',
  name: 'Voice (Yemot Hamashiach)',
  configSchema, uiHints,                      // from openclaw.plugin.json
  register(api) {
    const cfg = api.config                    // already validated against schema
    const service = new YemotService({ cfg, api })

    api.registerService(service)              // host owns start/stop
    api.registerGatewayMethod('voiceyemot.status', service.statusMethod)
    api.registerGatewayMethod('voiceyemot.list',   service.listMethod)
    api.registerGatewayMethod('voiceyemot.end',    service.endMethod)
  }
})
```

### 5.2 `YemotService` lifecycle

```
start():
  1. Validate runtime preconditions (publicBaseUrl set; sharedSecret set OR disableAuth)
  2. Construct yemot-router2 instance with handler from ./router-bridge.ts
  3. Construct Express app, mount auth middleware, mount router at <webhookPath>
  4. app.listen(port, host) → resolved when listening
  5. If autoConfigureExtension: bootstrapExtension(restClient, cfg)
        - Login → token
        - UpdateExtension(path=ivr2:/<extNum>, type=api, api_link=..., flags=...)
        - GetIVR2Dir(path=ivr2:/<extNum>) → verify api_link present
        - Retry with api_url= as fallback if api_link missing in read-back
        - Emit 'extension.configured' event with resolved api_link
  6. Mark service healthy

stop():
  1. Stop accepting new connections (server.close skipping callback)
  2. Wait up to 30s for active call coroutines to finish
  3. Force-end remaining: emit 'call.ended' { reason: 'shutdown' }; on next webhook
     for those callIds, return id_list_message with the shutdown message
  4. Close HTTP server fully
```

### 5.3 Per-call flow (handler coroutine)

```
async (call) => {
  const session = sessionRegistry.create(call)
  emit('call.initiated', { session })

  try {
    let nextPrompt = await agentLoop.firstTurn(session)
    while (true) {
      const userInput = await call.read(
        promptDirective(nextPrompt.spoken),
        nextPrompt.mode,                     // 'stt' | 'tap'
        modeOptions(nextPrompt, cfg)
      )
      session.transcript.push({ speaker: 'user', text: userInput, isFinal: true })
      emit(nextPrompt.mode === 'tap' ? 'call.dtmf' : 'call.speech',
           { session, text: userInput })

      nextPrompt = await agentLoop.nextTurn(session, userInput)
      if (nextPrompt.end) {
        emit('call.speaking', { session, text: nextPrompt.spoken })
        call.id_list_message(promptDirective(nextPrompt.spoken)) // throws ExitError
        break
      }
      session.transcript.push({ speaker: 'bot', text: nextPrompt.spoken })
      emit('call.speaking', { session, text: nextPrompt.spoken })
    }
  } catch (e) {
    if (!(e instanceof ExitError)) {
      emit('call.error', { session, error: e })
      try {
        call.id_list_message(promptDirective(cfg.call.fallbackErrorMessage))
      } catch (_) { /* already exiting */ }
    }
  } finally {
    emit('call.ended', { session, reason: deriveReason(...) })
    sessionRegistry.delete(session.callId)
  }
}
```

### 5.4 Agent-loop bridge (`agent-loop.ts`)

```
firstTurn(session) → AgentReply
  result = await api.runtime.agent.run({
    agentName: cfg.agent.name,
    input: '__call_started__',
    context: { channel: 'voice-yemot', phone, did, callId, language,
               systemAddon: cfg.agent.systemPromptAddon },
    conversationId: session.callId,         // memory scope = within-call
    signal: session.abortSignal              // aborts on caller hangup
  }) with timeout cfg.agent.responseTimeoutMs
  return parseAgentReply(result)             // strict JSON, auto-wrap fallback

nextTurn(session, userInput) → AgentReply
  // identical to firstTurn but input = userInput
```

`parseAgentReply` accepts either a JSON string `{spoken, mode?, tap?, end?}` (validated
against zod schema) or plain text (auto-wrapped to `{spoken: text, mode:'stt', end:false}`).
On schema-invalid JSON: 1 retry with corrective system message; on second failure, treat
as plain text and log warn.

### 5.5 Gateway methods

| Method | Returns | Use |
|---|---|---|
| `voiceyemot.status` | `{listening, port, baseUrl, activeCallCount, version, bootstrapStatus, lastAuthFailureAt?}` | Health/diagnostics |
| `voiceyemot.list` | `[{callId, phone, did, startedAt, lastTurnAt, transcriptLength}]` | What's in flight |
| `voiceyemot.end({callId})` | `{ok: true}` | Force-end a call on its next turn |

---

## 6. Configuration

Declared in `openclaw.plugin.json` as JSON Schema with `uiHints` and `secretInputs.paths`.

```jsonc
{
  "type": "object",
  "required": ["yemot", "agent", "server"],
  "properties": {
    "yemot": {
      "type": "object",
      "required": ["systemNumber", "username", "password", "extensionNumber"],
      "properties": {
        "systemNumber":     { "type": "string", "pattern": "^[0-9]+$" },
        "username":         { "type": "string" },
        "password":         { "type": "string" },                  // sensitive
        "extensionNumber":  { "type": "string", "default": "1" },
        "extensionTitle":   { "type": "string", "default": "OpenClaw Voice" },
        "apiBaseUrl":       { "type": "string", "format": "uri",
                              "default": "https://www.call2all.co.il/ym/api/" },
        "language":         { "type": "string", "default": "he-IL" },
        "removeInvalidTtsChars":   { "type": "boolean", "default": true },
        "autoConfigureExtension":  { "type": "boolean", "default": true }
      }
    },
    "server": {
      "type": "object",
      "properties": {
        "port":          { "type": "integer", "default": 4080 },
        "host":          { "type": "string",  "default": "0.0.0.0" },
        "webhookPath":   { "type": "string",  "default": "/yemot" },
        "publicBaseUrl": { "type": "string",  "format": "uri" },
        "sharedSecret":  { "type": "string",  "minLength": 16 },   // sensitive
        "disableAuth":   { "type": "boolean", "default": false }   // explicit opt-out
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
        "defaultMode":         { "enum": ["stt", "tap"], "default": "stt" },
        "sttQuietMaxSec":      { "type": "integer", "default": 3 },
        "sttMaxLengthSec":     { "type": "integer", "default": 30 },
        "callIdleTimeoutSec":  { "type": "integer", "default": 300 },
        "fallbackErrorMessage": {
          "type": "string",
          "default": "מצטערים, התרחשה תקלה. נסו שוב מאוחר יותר."
        }
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
}
```

### `channelEnvVars`

| Env var | Maps to |
|---|---|
| `YEMOT_USERNAME` | `yemot.username` |
| `YEMOT_PASSWORD` | `yemot.password` |
| `YEMOT_SYSTEM_NUMBER` | `yemot.systemNumber` |
| `YEMOT_EXTENSION_NUMBER` | `yemot.extensionNumber` |
| `VOICE_YEMOT_PUBLIC_URL` | `server.publicBaseUrl` |
| `VOICE_YEMOT_SHARED_SECRET` | `server.sharedSecret` |
| `VOICE_YEMOT_PORT` | `server.port` |
| `VOICE_YEMOT_AGENT` | `agent.name` |

### `secretInputs.paths`

`["yemot.password", "server.sharedSecret"]`

### User setup flow

1. Set the env vars (or fill the OpenClaw config UI form).
2. Restart the OpenClaw Gateway.
3. Place a test call.

---

## 7. Data flow (worked example)

A "Hebrew appointment booking" call. Caller dials `0772345678`. Extension `1` is
auto-bootstrapped. Webhook is `https://addin.example.com/yemot?secret=abc...`.

| Turn | From Yemot | Agent input | Agent output | To Yemot |
|---|---|---|---|---|
| 0 | `ApiCallId=YF-...&ApiPhone=0521234567&ApiDID=0772345678&ApiExtension=1&...` | `__call_started__` | `שלום! איך אפשר לעזור?` | `read=t-שלום! איך אפשר לעזור?=val_1,no,voice,he-IL,...` |
| 1 | `val_1=אני רוצה לקבוע תור לרופא שיניים&ApiCallId=YF-...` (echoed) | user transcript | `לאיזה יום תרצה?` | `read=t-לאיזה יום תרצה?=val_2,no,voice,...` |
| 2 | `val_2=שלישי הבא&val_1=...&ApiCallId=YF-...` | user transcript | `{"spoken":"באיזו שעה?","mode":"tap","tap":{"digits":["9","14","18"],"maxDigits":2,"timeoutSec":5}}` | `read=t-באיזו שעה?=val_3,no,2,1,5,Number,...,9.14.18,...` |
| 3 | `val_3=14&...` | DTMF | `{"spoken":"מעולה! נקבע לך תור ליום שלישי בשעה 14:00. שלום ולהתראות.","end":true}` | `id_list_message=t-מעולה...&go_to_folder=hangup` |

`val_*` accumulates across the call. The coroutine is suspended at `await call.read(...)`
and resumed when Yemot's next webhook lands carrying the same `ApiCallId`.

### Caller hangup mid-call

`ApiHangupExtension=/<ext>&hangup=yes` → yemot-router2 fires `call_hangup` event →
session's `abortController.abort()` cancels in-flight agent run → `call.ended` emitted with
`reason: 'hangup-user'` → session deleted.

### Caller silent

`stt` mode: `quiet_max=3s` → empty `val_n` returned. Passed verbatim to agent. Agent decides
to retry or end. After 2 consecutive empties or `maxTurnsPerCall` hit, addin force-ends with
`fallbackErrorMessage`.

---

## 8. Error handling

Seven categories, all logged via `api.logger` with structured fields:

| # | Category | Response | Recovery |
|---|---|---|---|
| 1 | Inbound auth fail | HTTP 403 | Log warn; never start session; `lastAuthFailureAt` exposed via status |
| 2 | Bootstrap REST fail | Service starts; bootstrap retried with backoff (1,2,4,8,16s) | After 5 fails, log error and continue (calls still flow if previously bootstrapped) |
| 3 | Agent timeout | Throw `AgentTimeoutError` | Play fallbackErrorMessage; emit `call.error` then `call.ended { reason: 'error' }` |
| 4 | Agent malformed JSON | Retry once with corrective prompt | On 2nd failure, treat as plain text, log warn |
| 5 | Yemot webhook oddities | If missing `ApiCallId`: 400. Orphan call (post-restart): treat as new call, agent input = `__call_resumed__` | Logged warn |
| 6 | Coroutine exception | Try/catch/finally wraps handler | Play fallbackErrorMessage; `call.ended { reason: 'error' }` |
| 7 | Graceful shutdown | Stop accepting; wait 30s; emit `call.ended { reason: 'shutdown' }` for stragglers | OS-level termination thereafter |

Sensitive fields (`password`, `sharedSecret`, REST `token`) **never** logged. Fallback
message played in **all** error categories — caller never hears dead air.

---

## 9. Testing strategy

### 9.1 Unit (vitest, ~25-40 tests)

`prompt-render`, `auth`, JSON contract validators, REST client wrappers (HTTP mocked via
`nock`), `bootstrap` (idempotency, field-name fallback), `agent-loop` (timeout, JSON retry,
schema validation, end-detection, abort-on-hangup).

### 9.2 Integration with mock Yemot harness (vitest, ~10-15 tests)

`test/helpers/mock-yemot.ts` is a tiny test-only HTTP client that **replays Yemot's webhook
protocol** against the addin's real Express server with a stubbed `api.runtime.agent`.
Scenarios:

1. Greeting → speak → reply → bot ends
2. 5-turn `stt` conversation
3. `stt` → `tap` mode switch mid-call
4. Caller hangup mid-conversation
5. 2× silent → fallback play
6. Agent throws → fallback played, `reason: 'error'`
7. Agent timeout → fallback
8. Agent JSON malformed twice → auto-wrap as text
9. Wrong secret → 403
10. Bootstrap calls correct REST endpoints
11. Orphan call (server restarted mid-call) → `__call_resumed__`
12. 3 concurrent calls — sessions isolated, no transcript bleed

### 9.3 Real-system smoke (manual, documented)

`npm run smoke` — script that hits real Yemot REST: `Login → UpdateExtension → GetIVR2Dir`,
prints resolved `api_link`. Manual call test documented in README. Smoke is a release gate,
not CI-run.

### 9.4 Frameworks & CI

- **Vitest** + **nock**
- GitHub Actions matrix: Node 20, 22; `typecheck`, `lint`, `test`
- Coverage **aspirational** — 80% line / 90% on critical paths (auth, bootstrap, agent-loop);
  no hard gate
- TDD discipline per the superpowers TDD skill

---

## 10. Project layout

```
openclaw-voice-yemot/
├── package.json
├── openclaw.plugin.json       # manifest: id, configSchema, uiHints, channelEnvVars
├── tsconfig.json
├── README.md
├── index.ts                   # default export: definePluginEntry({...})
├── src/
│   ├── manifest.ts
│   ├── service.ts             # YemotService — owns Express + router + lifecycle
│   ├── router-bridge.ts       # async (call) handler that drives the agent loop
│   ├── call-session.ts
│   ├── agent-loop.ts
│   ├── prompt-render.ts       # TTS abstraction seam
│   ├── auth.ts
│   ├── events.ts              # NormalizedEvent shapes (mirrored from voice-call)
│   ├── types.ts
│   ├── gateway-methods.ts
│   ├── logging.ts
│   └── yemot-rest/
│       ├── client.ts          # thin wrapper over MusiCode1/yemot-api
│       └── bootstrap.ts       # bootstrapExtension(cfg, restClient)
├── test/
│   ├── helpers/
│   │   ├── mock-yemot.ts      # mock Yemot HTTP protocol replayer
│   │   └── stub-agent.ts      # deterministic agent stub for integration tests
│   ├── unit/                  # one file per src module
│   └── integration/           # full-handler scenarios via mock harness
└── examples/
    └── basic-config.json5
```

Approx 12 source files, 600-900 LOC source + ~400 LOC tests + harness.

---

## 11. Out-of-scope / future tiers

| Tier | Feature | Why deferred |
|---|---|---|
| 2 | Outbound calls (Yemot campaigns + auto-template wire-up) | Independent surface; needs `voiceyemot.initiate` tool + template lifecycle |
| 3 | Mid-call transfer (`routing` / `routing_yemot`) as agent tool | Tool surface; needs agent-runtime tool registration design |
| 3 | Recording capture (record + REST download + ASR) | Adds external-ASR dependency; longer turn latency |
| 3 | External TTS backend behind the prompt-render seam | Quality/voice persona; latency/cost tradeoff |
| 3 | Tunnel orchestration (ngrok/tailscale auto) | Quality-of-life for dev; not core to Tier 1 |
| 3 | Per-DID agent routing | Single-tenant first |
| 4 | SMS, fax, payments, hold/music, hold queues | Unrelated surfaces |
| ∞ | Realtime audio streaming | Architecturally infeasible on Yemot's protocol |

Future work also includes: opening an issue/PR on `openclaw/openclaw` proposing
`api.registerVoiceCallProvider(...)` so this addin can graduate to a registered-provider
plugin, sharing voice-call's `CallManager` and event vocabulary fully.

---

## 12. Open risks

- **`api_link` vs `api_url` field-name uncertainty** — research strongly suggests `api_link`,
  but absent a definitive doc snippet, the bootstrap step verifies via `GetIVR2Dir` read-back
  and falls back to writing both keys if read-back fails. **Mitigation:** verification step;
  warning logged on fallback.
- **`MusiCode1/yemot-api` maintenance state** — last commits and current Node compatibility
  unverified. **Mitigation:** during implementation, smoke-test against current Node 20+;
  if broken, fall back to a ~80-line in-house REST client over `Login`, `UpdateExtension`,
  `GetIVR2Dir` with `node:fetch`.
- **`api.runtime.agent.run` exact signature** — research confirmed the path but not the
  precise param shape (`agentName`, `conversationId`, `signal` may have different names).
  **Mitigation:** read `extensions/voice-call/index.ts` and `src/manager.ts` during plan-step 1
  to ground the actual API.
- **OpenClaw plugin SDK churn** — `definePluginEntry`, `registerService`,
  `registerGatewayMethod` are the pillars; if any has shifted between the docs and `main`,
  the addin needs minor adjustment. **Mitigation:** pin to the SDK version we develop against.
- **Yemot built-in ASR quality on long Hebrew utterances** — `stt` mode is quality-good for
  short phrases; long sentences may degrade. **Mitigation:** v1 keeps prompts short by
  agent's system message; if quality is unacceptable, Tier 3 record + external Whisper is the
  upgrade path.
- **Caller-hangup abort cooperation** — `api.runtime.agent.run` may not honor `AbortSignal`.
  **Mitigation:** if not supported, let-finish (cost incurred, result discarded); document
  the cost.

---

## 13. References

- [OpenClaw repo](https://github.com/openclaw/openclaw) — `extensions/voice-call/`,
  `src/plugin-sdk/plugin-entry.ts`
- [OpenClaw docs](https://docs.openclaw.ai/)
- [Yemot API module forum thread (topic 56)](https://f2.freeivr.co.il/topic/56/)
- [Yemot REST API forum thread (topic 55)](https://f2.freeivr.co.il/topic/55/)
- [`UpdateExtension` official post](https://f2.freeivr.co.il/post/32060)
- [`UploadTextFile` official post](https://f2.freeivr.co.il/post/32056)
- [`GetTextFile` official post](https://f2.freeivr.co.il/post/32055)
- [API extension example with full ext.ini body](https://f2.freeivr.co.il/topic/19304/)
- [`yemot-router2` (ShlomoCode)](https://github.com/ShlomoCode/yemot-router2)
- [`yemot-api` (MusiCode1)](https://github.com/MusiCode1/yemot-api)
- [`yemot_api` Python (zevisvei)](https://github.com/zevisvei/yemot_api)
