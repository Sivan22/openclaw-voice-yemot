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
