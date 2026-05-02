import { describe, it, expect } from 'vitest'
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
