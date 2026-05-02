#!/usr/bin/env tsx
/** One-off: reset root behavior + plant our API at ivr2:/2.
 *
 *  Step 1 — clear our intercept on root: set type back to id_list_message,
 *           clear api_link, disable enter_id and white_list.
 *  Step 2 — bootstrap ivr2:/2 as type=api pointing at our webhook.
 */
import { YemotRestClient } from '../src/yemot-rest/client.js'
import { bootstrapExtension } from '../src/yemot-rest/bootstrap.js'

function need(name: string): string {
  const v = process.env[name]
  if (!v) { console.error(`Missing env var: ${name}`); process.exit(2) }
  return v
}

async function main(): Promise<void> {
  const client = new YemotRestClient({
    baseUrl: process.env.YEMOT_API_BASE_URL ?? 'https://www.call2all.co.il/ym/api/',
  })

  const username = need('YEMOT_USERNAME')
  const password = need('YEMOT_PASSWORD')

  console.log('1. Resetting ivr2:/ (root) ...')
  const token = await client.login({ username, password })
  await client.updateExtension(token, {
    path: 'ivr2:/',
    type: 'id_list_message',     // revert from api
    api_link: '',                // clear
    api_url: '',                 // clear legacy field too
    enter_id: 'no',
    enter_id_type: '',
    white_list: 'no',
    white_list_folder: '',
  })
  const v = await client.getIVR2Dir(token, 'ivr2:/')
  console.log('   root.type:        ', v.extIni.type)
  console.log('   root.api_link:    ', v.extIni.api_link ? `(STILL SET: ${v.extIni.api_link})` : '(cleared)')
  console.log('   root.enter_id:    ', v.extIni.enter_id)
  console.log('   root.white_list:  ', v.extIni.white_list)
  console.log('   root.id_list_msg: ', v.extIni.id_list_message_file)

  console.log('\n2. Bootstrapping ivr2:/2 as our API ...')
  const r = await bootstrapExtension(client, {
    username, password,
    extensionNumber: '2',
    extensionTitle: process.env.YEMOT_EXTENSION_TITLE ?? 'OpenClaw Voice (live test)',
    publicBaseUrl:   need('VOICE_YEMOT_PUBLIC_URL'),
    webhookPath:     process.env.VOICE_YEMOT_WEBHOOK_PATH ?? '/yemot',
    sharedSecret:    need('VOICE_YEMOT_SHARED_SECRET'),
  })
  if (!r.ok) {
    console.error('   bootstrap FAILED:', r.error?.message, '(attempts:', r.attempts, ')')
    process.exit(1)
  }
  console.log('   bootstrap: OK')
  console.log('   apiLink:   ', r.resolvedApiLink)
  console.log('   fellBackToApiUrl:', r.fellBackToApiUrl ?? false)

  console.log('\n✓ Done.')
  console.log('  Update .env: YEMOT_EXTENSION_NUMBER=2  (so future live restarts target ext 2)')
  console.log('  To test:    dial 0774511469, then press 2 (or *2) when prompted.')
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
