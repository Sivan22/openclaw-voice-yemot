import { describe, it, expect, vi } from 'vitest'
import { bootstrapExtension } from '../../src/yemot-rest/bootstrap.js'
import type { BootstrapResult } from '../../src/yemot-rest/bootstrap.js'
import type { YemotRestClient, UpdateExtensionFields, IVR2DirResult } from '../../src/yemot-rest/client.js'

function mkClient(impl: Partial<YemotRestClient>): YemotRestClient {
  return {
    login: vi.fn(),
    updateExtension: vi.fn(),
    getIVR2Dir: vi.fn(),
    ...impl,
  } as unknown as YemotRestClient
}

const baseInput = {
  username: 'u', password: 'p',
  extensionNumber: '1',
  extensionTitle: 'OpenClaw Voice',
  publicBaseUrl: 'https://addin.example.com',
  webhookPath: '/yemot',
  sharedSecret: 'sssssssssssssssss',
}

describe('bootstrapExtension', () => {
  it('happy path: login → updateExtension → getIVR2Dir verifies api_link', async () => {
    const updateExt = vi.fn().mockResolvedValue(undefined)
    const getDir = vi.fn().mockResolvedValue({
      extIni: { type: 'api', api_link: 'https://addin.example.com/yemot?secret=sssssssssssssssss' },
      thisPath: 'ivr2:/1', dirs: [], files: [],
    } satisfies IVR2DirResult)
    const client = mkClient({
      login: vi.fn().mockResolvedValue('tok-1'),
      updateExtension: updateExt,
      getIVR2Dir: getDir,
    })

    const r: BootstrapResult = await bootstrapExtension(client, baseInput)
    expect(r.ok).toBe(true)
    expect(r.resolvedApiLink).toBe('https://addin.example.com/yemot?secret=sssssssssssssssss')
    expect(r.fellBackToApiUrl).toBe(false)

    const passed = updateExt.mock.calls[0]![1] as UpdateExtensionFields
    expect(passed.path).toBe('ivr2:/1')
    expect(passed.type).toBe('api')
    expect(passed.api_link).toBe('https://addin.example.com/yemot?secret=sssssssssssssssss')
    expect(passed.api_url_post).toBe('yes')
    expect(passed.api_call_id_send).toBe('yes')
    expect(passed.api_phone_send).toBe('yes')
    expect(passed.api_did_send).toBe('yes')
    expect(passed.api_hangup_send).toBe('yes')
  })

  it('falls back to api_url when api_link missing in read-back', async () => {
    const updateExt = vi.fn().mockResolvedValue(undefined)
    let call = 0
    const getDir = vi.fn().mockImplementation(async () => {
      call++
      if (call === 1) {
        return { extIni: { type: 'api' /* no api_link */ }, thisPath: 'ivr2:/1', dirs: [], files: [] }
      }
      return { extIni: { type: 'api', api_url: 'https://addin.example.com/yemot?secret=sssssssssssssssss' }, thisPath: 'ivr2:/1', dirs: [], files: [] }
    })
    const client = mkClient({
      login: vi.fn().mockResolvedValue('tok-1'),
      updateExtension: updateExt,
      getIVR2Dir: getDir,
    })

    const r = await bootstrapExtension(client, baseInput)
    expect(r.ok).toBe(true)
    expect(r.fellBackToApiUrl).toBe(true)
    expect(r.resolvedApiLink).toBe('https://addin.example.com/yemot?secret=sssssssssssssssss')
    expect(updateExt).toHaveBeenCalledTimes(2)
    const second = updateExt.mock.calls[1]![1] as UpdateExtensionFields
    expect(second.api_url).toBe('https://addin.example.com/yemot?secret=sssssssssssssssss')
  })

  it('retries on transient errors with exponential backoff and ultimately fails', async () => {
    const client = mkClient({
      login: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      updateExtension: vi.fn(),
      getIVR2Dir: vi.fn(),
    })

    const r = await bootstrapExtension(client, { ...baseInput, retryDelaysMs: [1, 1, 1, 1, 1] })
    expect(r.ok).toBe(false)
    expect(r.error?.message).toMatch(/ECONNREFUSED/)
    expect(client.login).toHaveBeenCalledTimes(6)   // 1 initial + 5 retries
  })

  it('builds correct webhook URL when publicBaseUrl has trailing slash', async () => {
    const updateExt = vi.fn().mockResolvedValue(undefined)
    const getDir = vi.fn().mockResolvedValue({
      extIni: { type: 'api', api_link: 'https://addin.example.com/yemot?secret=sssssssssssssssss' },
      thisPath: 'ivr2:/1', dirs: [], files: [],
    })
    const client = mkClient({
      login: vi.fn().mockResolvedValue('tok-1'),
      updateExtension: updateExt,
      getIVR2Dir: getDir,
    })
    await bootstrapExtension(client, { ...baseInput, publicBaseUrl: 'https://addin.example.com/' })
    const fields = updateExt.mock.calls[0]![1] as UpdateExtensionFields
    // No double slash:
    expect(fields.api_link).toBe('https://addin.example.com/yemot?secret=sssssssssssssssss')
  })

  it('retries are eventually successful: rejects, then resolves on retry', async () => {
    let n = 0
    const client = mkClient({
      login: vi.fn().mockImplementation(async () => {
        n++
        if (n < 3) throw new Error('transient')
        return 'tok-1'
      }),
      updateExtension: vi.fn().mockResolvedValue(undefined),
      getIVR2Dir: vi.fn().mockResolvedValue({
        extIni: { type: 'api', api_link: 'https://addin.example.com/yemot?secret=sssssssssssssssss' },
        thisPath: 'ivr2:/1', dirs: [], files: [],
      }),
    })
    const r = await bootstrapExtension(client, { ...baseInput, retryDelaysMs: [1, 1, 1, 1, 1] })
    expect(r.ok).toBe(true)
    expect(client.login).toHaveBeenCalledTimes(3)
  })
})
