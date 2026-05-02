// @ts-expect-error -- the openclaw npm package isn't installed as a local
// dev-dep; types resolve via the host's plugin-sdk at runtime.
import { definePluginEntry } from 'openclaw/plugin-sdk/core'
import crypto from 'node:crypto'
import { YemotService } from './src/service.js'
import { buildGatewayMethods } from './src/gateway-methods.js'
import type { PluginConfig } from './src/types.js'

/* eslint-disable @typescript-eslint/no-explicit-any -- mirroring voice-call's
   internal agent-runtime calls; OpenClaw doesn't ship public types for these
   helpers, so we surface them as `any` and rely on the host runtime to satisfy
   the shape. */
interface AgentRuntimeLike {
  session: {
    resolveStorePath: (storeCfg: unknown, opts: { agentId: string }) => string
    loadSessionStore: (path: string) => Record<string, { sessionId: string; updatedAt: number }>
    saveSessionStore: (path: string, store: unknown) => Promise<void>
    resolveSessionFilePath: (sessionId: string, entry: unknown, opts: { agentId: string }) => string
  }
  resolveAgentDir: (cfg: unknown, agentId: string) => string
  resolveAgentWorkspaceDir: (cfg: unknown, agentId: string) => string
  ensureAgentWorkspace: (params: { dir: string }) => Promise<unknown>
  resolveAgentIdentity: (cfg: unknown, agentId: string) => { name?: string } | null
  resolveThinkingDefault: (params: { cfg: unknown; provider: string; model: string }) => unknown
  resolveAgentTimeoutMs: (params: { cfg: unknown }) => number
  runEmbeddedPiAgent: (params: any) => Promise<{ payloads?: any[]; meta?: { aborted?: boolean } }>
  defaults: { model: string; provider: string }
}

interface OpenClawPluginApi {
  pluginConfig: PluginConfig
  config: any                     // full OpenClawConfig
  logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void; debug?: (m: string, ctx?: Record<string, unknown>) => void }
  runtime: { agent: AgentRuntimeLike }
  registerService: (service: { id?: string; name?: string; start(): unknown; stop(): unknown }) => void
  registerGatewayMethod: (name: string, handler: (args: unknown) => unknown) => void
}

/**
 * Resolve the (provider, model) the agent should run with.
 * Mirrors the simple path: use the global agents.defaults.model.primary.
 */
function resolveAgentModel(cfg: any, agentRuntime: AgentRuntimeLike): { provider: string; model: string } {
  const primary = cfg?.agents?.defaults?.model?.primary
  if (typeof primary === 'string' && primary.includes('/')) {
    const [provider, ...rest] = primary.split('/')
    return { provider: provider!, model: rest.join('/') }
  }
  return { provider: agentRuntime.defaults.provider, model: agentRuntime.defaults.model }
}

/**
 * Voice-call uses an internal helper; we replicate it inline.
 * Keep the agent's tool-policy resolution scoped to a "voice" sandbox.
 */
function buildSandboxSessionKey(agentId: string, sessionKey: string): string {
  const trimmed = sessionKey.trim()
  if (trimmed.toLowerCase().startsWith('agent:')) return trimmed
  return `agent:${agentId}:${trimmed}`
}

/**
 * Concatenate the text payloads from runEmbeddedPiAgent's result. The agent
 * may emit several text blocks; we want the last non-empty one (the final
 * spoken reply, after any thinking/tool blocks).
 */
function extractFinalText(payloads: unknown[] | undefined): string | null {
  if (!payloads) return null
  for (let i = payloads.length - 1; i >= 0; i--) {
    const p = payloads[i] as { isError?: boolean; isReasoning?: boolean; text?: string } | null
    if (!p || p.isError || p.isReasoning) continue
    const text = p.text?.trim() ?? ''
    if (text) return text
  }
  return null
}

export default definePluginEntry({
  id: 'voice-yemot',
  name: 'Voice (Yemot Hamashiach)',
  description: 'Inbound voice channel for Yemot Hamashiach',
  register(api: OpenClawPluginApi) {
    const cfg = api.pluginConfig
    const fullCfg = api.config
    const agentRuntime = api.runtime.agent
    const agentId = cfg.agent.name || 'main'

    const hostLogger = {
      debug: (m: string) => api.logger.debug?.(m),
      info:  (m: string) => api.logger.info(m),
      warn:  (m: string) => api.logger.warn(m),
      error: (m: string) => api.logger.error(m),
    }
    const service = new YemotService({
      cfg,
      logger: hostLogger,
      runner: async ({ input, context, conversationId }) => {
        const sysPrompt = (context as { systemPromptAddon?: string })?.systemPromptAddon ?? cfg.agent.systemPromptAddon
        const message = input === '__call_started__'
          ? 'A new phone call just started. Greet the caller in Hebrew and ask how you can help. Reply per the JSON contract.'
          : input

        // Mirror voice-call's generateVoiceResponse setup: per-call session key,
        // resolved agent dirs, session store entry, embedded Pi agent run.
        const sessionKey = `voice-yemot:${conversationId}`
        const storePath = agentRuntime.session.resolveStorePath(fullCfg?.session?.store, { agentId })
        const agentDir = agentRuntime.resolveAgentDir(fullCfg, agentId)
        const workspaceDir = agentRuntime.resolveAgentWorkspaceDir(fullCfg, agentId)
        await agentRuntime.ensureAgentWorkspace({ dir: workspaceDir })

        const sessionStore = agentRuntime.session.loadSessionStore(storePath)
        let entry = sessionStore[sessionKey]
        if (!entry) {
          entry = { sessionId: crypto.randomUUID(), updatedAt: Date.now() }
          sessionStore[sessionKey] = entry
          await agentRuntime.session.saveSessionStore(storePath, sessionStore)
        }
        const sessionFile = agentRuntime.session.resolveSessionFilePath(entry.sessionId, entry, { agentId })

        const { provider, model } = resolveAgentModel(fullCfg, agentRuntime)
        const thinkLevel = agentRuntime.resolveThinkingDefault({ cfg: fullCfg, provider, model })
        const runId = `voice-yemot:${conversationId}:${Date.now()}`

        const t0 = Date.now()
        api.logger.info(`voice-yemot runEmbeddedPiAgent conv=${conversationId} model=${provider}/${model} input=${JSON.stringify(message.slice(0, 120))}`)

        const result = await agentRuntime.runEmbeddedPiAgent({
          sessionId: entry.sessionId,
          sessionKey,
          sandboxSessionKey: buildSandboxSessionKey(agentId, sessionKey),
          agentId,
          messageProvider: 'voice-yemot',
          sessionFile,
          workspaceDir,
          config: fullCfg,
          prompt: message,
          provider,
          model,
          thinkLevel,
          verboseLevel: 'off',
          timeoutMs: cfg.agent.responseTimeoutMs,
          runId,
          lane: 'voice',
          extraSystemPrompt: sysPrompt,
          agentDir,
        })

        if (result.meta?.aborted) {
          throw new Error(`runEmbeddedPiAgent ${runId} aborted after ${Date.now() - t0}ms`)
        }
        const reply = extractFinalText(result.payloads)
        if (!reply) {
          throw new Error(`runEmbeddedPiAgent ${runId} produced no text after ${Date.now() - t0}ms (${result.payloads?.length ?? 0} payloads)`)
        }
        api.logger.info(`voice-yemot runEmbeddedPiAgent reply conv=${conversationId} ms=${Date.now() - t0} text=${JSON.stringify(reply.slice(0, 200))}`)
        return reply
      },
      onEvent: (e) => {
        api.logger.info(`voice-yemot event type=${e.type}${'session' in e ? ` call=${e.session.callId}` : ''}`)
      },
    })

    api.registerService({
      id: 'voiceyemot',
      start: () => service.start(),
      stop: () => service.stop(),
    })

    const gw = buildGatewayMethods(service)
    api.registerGatewayMethod('voiceyemot.status', () => gw.status({}))
    api.registerGatewayMethod('voiceyemot.list',   () => gw.list({}))
    api.registerGatewayMethod('voiceyemot.end',    (args) => gw.end(args as { callId: string }))
  },
})
