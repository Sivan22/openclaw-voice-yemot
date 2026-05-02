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
