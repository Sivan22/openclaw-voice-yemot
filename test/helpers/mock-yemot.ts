export interface YemotBaseParams {
  ApiCallId: string
  ApiPhone: string
  ApiDID: string
  ApiRealDID: string
  ApiExtension: string
  ApiTime: string
  ApiYFCallId: string
}

export type Turn =
  | { input: Record<string, string> }
  | { hangup: true }

export interface TurnLog {
  request: Record<string, string>
  response: string
}

export class MockYemotCaller {
  private accumulatedValues: Record<string, string> = {}

  constructor(
    private readonly endpointUrl: string,        // e.g. http://127.0.0.1:1234/yemot
    private readonly base: YemotBaseParams,
    private readonly secret: string,
  ) {}

  async simulateCall(script: Turn[]): Promise<TurnLog[]> {
    const log: TurnLog[] = []
    // Turn 0: initial webhook (no val_*)
    let response = await this.send({})
    log.push({ request: this.lastRequestBody!, response })

    for (const turn of script) {
      if ('hangup' in turn) {
        const finalResp = await this.send({ hangup: 'yes', ApiHangupExtension: '/' + this.base.ApiExtension })
        log.push({ request: this.lastRequestBody!, response: finalResp })
        break
      }
      // Add the user-input fields to the running accumulation
      for (const [k, v] of Object.entries(turn.input)) {
        this.accumulatedValues[k] = v
      }
      response = await this.send(turn.input)
      log.push({ request: this.lastRequestBody!, response })
    }

    return log
  }

  private lastRequestBody?: Record<string, string>

  private async send(extra: Record<string, string>): Promise<string> {
    const body: Record<string, string> = {
      ...this.base,
      ...this.accumulatedValues,
      ...extra,
    }
    this.lastRequestBody = body

    const url = this.endpointUrl + (this.endpointUrl.includes('?') ? '&' : '?') + 'secret=' + encodeURIComponent(this.secret)
    const formBody = new URLSearchParams(body).toString()
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody,
    })
    if (!res.ok) {
      throw new Error(`MockYemotCaller: HTTP ${res.status} from ${url}`)
    }
    return await res.text()
  }
}
