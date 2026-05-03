# openclaw-voice-yemot

OpenClaw voice-channel addin for Yemot Hamashiach (ימות המשיח), the Israeli IVR provider.

Hebrew menu-driven IVR backed by an LLM agent. Each turn: agent text → Yemot's
built-in Hebrew TTS → caller speaks or presses keys → Yemot's built-in ASR/DTMF →
next agent turn.

## Why & limits

- Yemot's API is **strictly turn-based HTTP webhook** — no realtime audio
  streaming. The caller hears silence on the line until the agent replies. For
  conversational AI with sub-second barge-in, use a Twilio-based addin instead.
- **Per-turn latency = your agent's wall-clock time.** With a small/fast model
  (e.g. Claude Haiku) expect ~10–20s per turn warm, and a longer cold-start
  delay on the first turn of a new session (often 60–120s, depending on your
  OpenClaw setup). Keep your spoken replies short.
- v1 is **inbound calls only**. Outbound campaigns are a future tier.

## Install

```bash
npm install openclaw-voice-yemot
```

(Or, in OpenClaw: `openclaw plugins install github:Sivan22/openclaw-voice-yemot`.)

## Setup

### 1. You'll need

- A **Yemot Hamashiach account** with a phone number. Sign up at
  [yemot.com](https://www.call2all.co.il/ym/customer/register.aspx). Yemot is a
  paid service; pricing is per-call and per-TTS-character.
- An **OpenClaw install** with a configured agent (the default `main` agent is
  fine for a first run).
- A **public HTTPS URL** that forwards to your local addin (Yemot's webhook
  needs to reach you from the public internet).

### 2. Expose your local addin to the public internet

The addin listens on `127.0.0.1:<port>` (default 4080). Pick whichever tunnel
you like:

```bash
# cloudflared (free, stable hostname requires a Cloudflare account)
cloudflared tunnel --url http://localhost:4080

# ngrok (free tier gives you a random hostname per session)
ngrok http 4080
```

Copy the `https://...` URL it prints — that's your `VOICE_YEMOT_PUBLIC_URL`.

### 3. Set these environment variables

| Var | Meaning |
|---|---|
| `YEMOT_USERNAME` | Yemot account username |
| `YEMOT_PASSWORD` | Yemot account password |
| `YEMOT_SYSTEM_NUMBER` | The Yemot phone number (informational) |
| `YEMOT_EXTENSION_NUMBER` | Extension to wire (default `1`). If `1` is already in use on your Yemot account, pick a free extension number. |
| `VOICE_YEMOT_PUBLIC_URL` | The HTTPS URL from step 2 |
| `VOICE_YEMOT_SHARED_SECRET` | A long random string; Yemot will pass it as `?secret=` and the addin verifies. Auto-generated on first start if blank. |
| `VOICE_YEMOT_AGENT` | Name of the OpenClaw agent to bind (default: `main`) |

### 4. Restart the OpenClaw Gateway

The addin will auto-configure your Yemot extension to point at its webhook on
first start. No manual Yemot admin step is required.

> **Note:** auto-bootstrap configures only the *one* extension named in
> `YEMOT_EXTENSION_NUMBER`. If your Yemot account's root menu doesn't already
> route to that extension, callers landing on the system number won't reach
> the addin. Either pick an extension your root menu already routes to, or set
> up that routing in your Yemot console once.

### 5. Dial in

Call your `YEMOT_SYSTEM_NUMBER` and (if needed) navigate to your extension. You
should hear the agent's greeting. Expect a longer pause on the **first** turn
of the day — see "Why & limits" above. If you hear silence followed by the
fallback error message, your agent took longer than `agent.responseTimeoutMs`
(default 60s) — bump it.

## Local development

```bash
git clone https://github.com/Sivan22/openclaw-voice-yemot
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
