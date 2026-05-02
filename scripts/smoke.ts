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
