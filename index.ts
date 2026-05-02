import { YemotService } from './src/service.js'
import { buildGatewayMethods } from './src/gateway-methods.js'
import type { PluginConfig } from './src/types.js'

/**
 * OpenClaw plugin SDK shapes — UNVERIFIED against an installed SDK at the time
 * of writing. Replace with the real types from `@openclaw/plugin-sdk`
 * (or whatever the SDK's package name is) once present.
 */
type OpenClawPluginApi = {
  config: PluginConfig
  logger?: { info: (m: string, c?: unknown) => void; warn: (m: string, c?: unknown) => void; error: (m: string, c?: unknown) => void; debug: (m: string, c?: unknown) => void }
  runtime: {
    agent: {
      run: (input: {
        agentName: string
        input: string
        context: unknown
        conversationId: string
        signal?: AbortSignal
      }) => Promise<string>
    }
  }
  registerService: (service: { name?: string; start(): Promise<void>; stop(): Promise<void> }) => void
  registerGatewayMethod: <Args, Result>(name: string, handler: (args: Args) => Result | Promise<Result>) => void
}

interface DefinePluginEntryArgs {
  id: string
  name: string
  description: string
  register: (api: OpenClawPluginApi) => void
}

// Resolve definePluginEntry from the host. We accept multiple possible paths
// the SDK may expose. The `as any` is intentional during scaffolding;
// once the SDK is pinned, replace with a static import.
async function resolveDefiner(): Promise<(a: DefinePluginEntryArgs) => unknown> {
  const candidates = [
    '@openclaw/plugin-sdk/plugin-entry',
    '@openclaw/plugin-sdk',
    'openclaw/plugin-sdk',
  ]
  for (const c of candidates) {
    try {
      const mod = await import(c) as Record<string, unknown>
      if (typeof mod.definePluginEntry === 'function') {
        return mod.definePluginEntry as (a: DefinePluginEntryArgs) => unknown
      }
      if (typeof mod.default === 'function') {
        return mod.default as (a: DefinePluginEntryArgs) => unknown
      }
    } catch { /* try next */ }
  }
  // Last-resort placeholder (development without the host SDK present).
  // Returns the args so tests can still import this file.
  return (a: DefinePluginEntryArgs) => a
}

const definer = await resolveDefiner()

export default definer({
  id: 'voice-yemot',
  name: 'Voice (Yemot Hamashiach)',
  description: 'Inbound voice channel for Yemot Hamashiach',
  register(api: OpenClawPluginApi) {
    const cfg = api.config
    const service = new YemotService({
      cfg,
      logger: api.logger,
      runner: ({ agentName, input, context, conversationId, signal }) =>
        api.runtime.agent.run({ agentName, input, context, conversationId, signal }),
      onEvent: (e) => {
        // For v1 we only log; future tiers can wire to api.events.emit if available.
        api.logger?.debug('voice-yemot event', { type: e.type })
      },
    })

    api.registerService({
      name: 'voice-yemot',
      start: () => service.start(),
      stop: () => service.stop(),
    })

    const gw = buildGatewayMethods(service)
    api.registerGatewayMethod('voiceyemot.status', gw.status)
    api.registerGatewayMethod('voiceyemot.list',   gw.list)
    api.registerGatewayMethod('voiceyemot.end',    gw.end)
  },
})
