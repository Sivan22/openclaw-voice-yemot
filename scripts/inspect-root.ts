#!/usr/bin/env tsx
/** Quick inspector — list what's currently at ivr2:/ and ivr2:/1 so we can
 *  decide where to plant our api extension. */
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

  for (const path of ['ivr2:/', 'ivr2:/1', 'ivr2:/2']) {
    try {
      const r = await client.getIVR2Dir(token, path)
      console.log(`\n=== ${path} ===`)
      console.log('  extIni:  ', JSON.stringify(r.extIni, null, 2))
      console.log('  dirs:    ', r.dirs.length, JSON.stringify(r.dirs, null, 2))
      console.log('  files:   ', r.files.length)
    } catch (e) {
      console.log(`\n=== ${path} ===  (error: ${(e as Error).message})`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
