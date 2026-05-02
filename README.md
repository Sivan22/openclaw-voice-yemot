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
