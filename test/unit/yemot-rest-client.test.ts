import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import nock from 'nock'
import { YemotRestClient } from '../../src/yemot-rest/client.js'

const BASE = 'https://www.call2all.co.il'
const PATH = '/ym/api'

// nock v14, when intercepting fetch with `application/x-www-form-urlencoded`
// content-type, parses the body to an object before invoking the body matcher.
// This helper normalizes either form back to a urlencoded string so existing
// regex / .toContain assertions continue to express the wire-format intent.
function toForm(body: unknown): string {
  if (typeof body === 'string') return body
  if (body && typeof body === 'object') {
    return new URLSearchParams(body as Record<string, string>).toString()
  }
  return String(body)
}

describe('YemotRestClient', () => {
  beforeEach(() => { nock.cleanAll() })
  afterEach(() => { nock.cleanAll() })

  it('login: returns the token from response', async () => {
    nock(BASE)
      .post(PATH + '/Login', body => /username=u&password=p/.test(toForm(body)))
      .reply(200, { responseStatus: 'OK', token: 'tok-123' })

    const c = new YemotRestClient({ baseUrl: BASE + PATH + '/' })
    const tok = await c.login({ username: 'u', password: 'p' })
    expect(tok).toBe('tok-123')
  })

  it('login: throws on responseStatus != OK', async () => {
    nock(BASE)
      .post(PATH + '/Login')
      .reply(200, { responseStatus: 'EXCEPTION', message: 'bad creds' })

    const c = new YemotRestClient({ baseUrl: BASE + PATH + '/' })
    await expect(c.login({ username: 'u', password: 'wrong' })).rejects.toThrow(/bad creds/)
  })

  it('updateExtension: posts the merged ext.ini fields', async () => {
    let captured = ''
    nock(BASE)
      .post(PATH + '/UpdateExtension', body => { captured = toForm(body); return true })
      .reply(200, { responseStatus: 'OK' })

    const c = new YemotRestClient({ baseUrl: BASE + PATH + '/' })
    await c.updateExtension('tok-123', {
      path: 'ivr2:/1',
      type: 'api',
      title: 'OpenClaw Voice',
      api_link: 'https://x.example/yemot?secret=abc',
      api_url_post: 'yes',
      api_call_id_send: 'yes',
    })
    expect(captured).toContain('token=tok-123')
    expect(captured).toContain('path=ivr2%3A%2F1')
    expect(captured).toContain('type=api')
    expect(captured).toContain('api_link=https%3A%2F%2Fx.example%2Fyemot%3Fsecret%3Dabc')
    expect(captured).toContain('api_url_post=yes')
    expect(captured).toContain('api_call_id_send=yes')
  })

  it('getIVR2Dir: returns parsed extIni', async () => {
    nock(BASE)
      .post(PATH + '/GetIVR2Dir')
      .reply(200, {
        responseStatus: 'OK',
        extIni: { type: 'api', api_link: 'https://x/y', title: 'OpenClaw' },
        thisPath: 'ivr2:/1',
        dirs: [],
        files: [],
      })

    const c = new YemotRestClient({ baseUrl: BASE + PATH + '/' })
    const r = await c.getIVR2Dir('tok-123', 'ivr2:/1')
    expect(r.extIni).toEqual({ type: 'api', api_link: 'https://x/y', title: 'OpenClaw' })
  })

  it('getIVR2Dir: throws when responseStatus != OK', async () => {
    nock(BASE)
      .post(PATH + '/GetIVR2Dir')
      .reply(200, { responseStatus: 'NOT_FOUND', message: 'no such path' })

    const c = new YemotRestClient({ baseUrl: BASE + PATH + '/' })
    await expect(c.getIVR2Dir('tok-123', 'ivr2:/99')).rejects.toThrow(/no such path/)
  })

  it('login: surfaces network errors', async () => {
    nock(BASE).post(PATH + '/Login').replyWithError({ code: 'ECONNREFUSED', message: 'refused' })
    const c = new YemotRestClient({ baseUrl: BASE + PATH + '/' })
    await expect(c.login({ username: 'u', password: 'p' })).rejects.toThrow()
  })
})
