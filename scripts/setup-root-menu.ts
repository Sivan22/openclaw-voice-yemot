#!/usr/bin/env tsx
/** Make root (ivr2:/) a routing menu: caller presses 1 -> /1, 2 -> /2.
 *  We also seed a short TTS prompt so the caller knows what to press. */
import { YemotRestClient } from '../src/yemot-rest/client.js'

function need(name: string): string {
  const v = process.env[name]
  if (!v) { console.error(`Missing env var: ${name}`); process.exit(2) }
  return v
}

async function main(): Promise<void> {
  const client = new YemotRestClient({
    baseUrl: process.env.YEMOT_API_BASE_URL ?? 'https://www.call2all.co.il/ym/api/',
  })
  const token = await client.login({
    username: need('YEMOT_USERNAME'),
    password: need('YEMOT_PASSWORD'),
  })

  // type=menu makes Yemot wait for a digit and route to the matching sub-extension.
  // We also clear id_list_message_file (was /1, made root play that audio first).
  await client.updateExtension(token, {
    path: 'ivr2:/',
    type: 'menu',
    id_list_message_file: '',
    api_link: '',
    api_url: '',
  })

  const v = await client.getIVR2Dir(token, 'ivr2:/')
  console.log('root after update:')
  console.log('  type:                ', v.extIni.type)
  console.log('  id_list_message_file:', v.extIni.id_list_message_file || '(cleared)')
  console.log('  api_link:            ', v.extIni.api_link || '(cleared)')
  console.log('  digits:              ', v.extIni.digits)
  console.log('  attempts:            ', v.extIni.attempts)
  console.log('  timeout:             ', v.extIni.timeout)
  console.log('\nDial 0774511469 and press 1 (old behavior) or 2 (our API).')
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
