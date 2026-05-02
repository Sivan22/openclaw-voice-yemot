export interface YemotRestClientOptions {
  baseUrl: string                 // e.g. https://www.call2all.co.il/ym/api/
}

export interface UpdateExtensionFields {
  path: string                    // e.g. "ivr2:/1"
  type?: string                   // "api"
  title?: string
  api_link?: string
  api_url_post?: 'yes' | 'no'
  api_call_id_send?: 'yes' | 'no'
  api_phone_send?: 'yes' | 'no'
  api_did_send?: 'yes' | 'no'
  api_real_did_send?: 'yes' | 'no'
  api_extension_send?: 'yes' | 'no'
  api_time_send?: 'yes' | 'no'
  api_yf_call_id_send?: 'yes' | 'no'
  api_hangup_send?: 'yes' | 'no'
  [k: string]: string | undefined
}

export interface IVR2DirResult {
  extIni: Record<string, string>
  thisPath: string
  dirs: unknown[]
  files: unknown[]
}

export class YemotRestError extends Error {
  constructor(message: string, public readonly responseStatus?: string) {
    super(message)
    this.name = 'YemotRestError'
  }
}

export class YemotRestClient {
  private readonly baseUrl: string

  constructor(opts: YemotRestClientOptions) {
    this.baseUrl = opts.baseUrl.endsWith('/') ? opts.baseUrl : opts.baseUrl + '/'
  }

  async login(creds: { username: string; password: string }): Promise<string> {
    const data = await this.post('Login', {
      username: creds.username,
      password: creds.password,
    })
    if (typeof data.token !== 'string') {
      throw new YemotRestError(`Login: missing token in response`, data.responseStatus as string | undefined)
    }
    return data.token
  }

  async updateExtension(token: string, fields: UpdateExtensionFields): Promise<void> {
    const body: Record<string, string> = { token }
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) body[k] = v
    }
    await this.post('UpdateExtension', body)
  }

  async getIVR2Dir(token: string, path: string): Promise<IVR2DirResult> {
    const data = await this.post('GetIVR2Dir', { token, path })
    return {
      extIni: (data.extIni ?? {}) as Record<string, string>,
      thisPath: typeof data.thisPath === 'string' ? data.thisPath : path,
      dirs: Array.isArray(data.dirs) ? data.dirs : [],
      files: Array.isArray(data.files) ? data.files : [],
    }
  }

  private async post(endpoint: string, body: Record<string, string>): Promise<Record<string, unknown>> {
    const url = this.baseUrl + endpoint
    const formBody = new URLSearchParams(body).toString()
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody,
    })
    if (!res.ok) {
      throw new YemotRestError(`${endpoint}: HTTP ${res.status}`)
    }
    const data = await res.json() as Record<string, unknown>
    const status = data.responseStatus
    if (status !== undefined && status !== 'OK') {
      const msg = typeof data.message === 'string' ? data.message : `responseStatus=${String(status)}`
      throw new YemotRestError(`${endpoint}: ${msg}`, String(status))
    }
    return data
  }
}
