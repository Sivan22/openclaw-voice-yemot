import express from 'express'
import type { Server } from 'node:http'
import { YemotRouter } from 'yemot-router2'
import { createAuthMiddleware } from './auth.js'
import { SessionRegistry } from './call-session.js'
import { AgentLoop, type AgentRunner } from './agent-loop.js'
import { buildCallHandler } from './router-bridge.js'
import type { NormalizedEvent } from './events.js'
import type { PluginConfig } from './types.js'
import { wrapHostLogger, type PluginLogger } from './logging.js'

export interface ServiceState {
  listening: boolean
  port: number
  baseUrl: string
  activeCallCount: number
  version: string
  bootstrapStatus: 'pending' | 'ok' | 'failed' | 'skipped'
  bootstrapError?: string
  lastAuthFailureAt?: number
}

export interface YemotServiceOptions {
  cfg: PluginConfig
  runner: AgentRunner
  logger?: PluginLogger
  onEvent?: (e: NormalizedEvent) => void
}

const VERSION = '0.1.0'

export class YemotService {
  private app = express()
  private server?: Server
  private actualPort = 0
  private listening = false
  private bootstrapStatus: ServiceState['bootstrapStatus'] = 'pending'
  private bootstrapError?: string
  private lastAuthFailureAt?: number

  private registry = new SessionRegistry()
  private agentLoop: AgentLoop
  private logger: PluginLogger

  constructor(private readonly opts: YemotServiceOptions) {
    this.logger = wrapHostLogger(opts.logger)
    this.agentLoop = new AgentLoop({
      runner: opts.runner,
      cfg: {
        agentName: opts.cfg.agent.name,
        systemPromptAddon: opts.cfg.agent.systemPromptAddon,
        responseTimeoutMs: opts.cfg.agent.responseTimeoutMs,
        fallbackErrorMessage: opts.cfg.call.fallbackErrorMessage,
      },
    })
  }

  async start(): Promise<void> {
    // Spec §5.2 step 1: validate runtime preconditions before starting.
    // publicBaseUrl is only required when we auto-configure the Yemot extension
    // (we need a URL to send Yemot in the api_link). Without auto-configure the
    // user is wiring Yemot's admin manually and we don't need to know.
    if (this.opts.cfg.yemot.autoConfigureExtension && !this.opts.cfg.server.publicBaseUrl) {
      throw new Error(
        'voice-yemot: server.publicBaseUrl is required when yemot.autoConfigureExtension=true (the public URL Yemot calls back; use ngrok or similar for local dev).',
      )
    }
    if (!this.opts.cfg.server.disableAuth && !this.opts.cfg.server.sharedSecret) {
      // Auto-generate so the help text "Auto-generated if blank" actually holds.
      const { randomBytes } = await import('node:crypto')
      const generated = randomBytes(24).toString('base64url')
      this.opts.cfg.server.sharedSecret = generated
      this.logger.warn(
        'voice-yemot: server.sharedSecret was empty; auto-generated. Configure it in your env to keep the secret stable across restarts.',
      )
    }

    this.app.use(express.urlencoded({ extended: true }))
    this.app.use(this.opts.cfg.server.webhookPath, createAuthMiddleware({
      sharedSecret: this.opts.cfg.server.sharedSecret,
      disableAuth: this.opts.cfg.server.disableAuth,
      onAuthFailure: info => {
        this.lastAuthFailureAt = Date.now()
        this.opts.onEvent?.({ type: 'auth.failed', remoteIp: info.remoteIp, reason: info.reason })
        this.logger.warn('webhook auth failed', info)
      },
    }))

    const router = YemotRouter({
      timeout: 60_000,
      printLog: false,
      defaults: {
        removeInvalidChars: this.opts.cfg.yemot.removeInvalidTtsChars,
      },
    })

    const handler = buildCallHandler({
      registry: this.registry,
      agentLoop: this.agentLoop,
      cfg: {
        defaultMode: this.opts.cfg.call.defaultMode,
        sttQuietMaxSec: this.opts.cfg.call.sttQuietMaxSec,
        sttMaxLengthSec: this.opts.cfg.call.sttMaxLengthSec,
        language: this.opts.cfg.yemot.language,
        removeInvalidTtsChars: this.opts.cfg.yemot.removeInvalidTtsChars,
        fallbackErrorMessage: this.opts.cfg.call.fallbackErrorMessage,
        maxTurnsPerCall: this.opts.cfg.agent.maxTurnsPerCall,
      },
      emit: e => this.opts.onEvent?.(e),
    })

    router.all('/', handler as unknown as Parameters<typeof router.all>[1])

    this.app.use(this.opts.cfg.server.webhookPath, router as unknown as express.RequestHandler)

    await new Promise<void>((resolve, reject) => {
      this.server = this.app.listen(this.opts.cfg.server.port, this.opts.cfg.server.host, () => {
        this.actualPort = (this.server!.address() as { port: number }).port
        this.listening = true
        this.logger.info('yemot service listening', { port: this.actualPort, baseUrl: this.opts.cfg.server.publicBaseUrl })
        resolve()
      })
      this.server!.on('error', reject)
    })

    if (this.opts.cfg.yemot.autoConfigureExtension) {
      this.bootstrapStatus = 'pending'
      // Spec §5.2 step 5: service is already listening; bootstrap runs in the background.
      // A Yemot REST outage at boot must not block startup — calls already-bootstrapped
      // on a prior run continue to work even if today's bootstrap fails.
      void this.runBootstrapInBackground()
    } else {
      this.bootstrapStatus = 'skipped'
    }
  }

  private async runBootstrapInBackground(): Promise<void> {
    try {
      const { bootstrapExtension } = await import('./yemot-rest/bootstrap.js')
      const { YemotRestClient } = await import('./yemot-rest/client.js')
      const client = new YemotRestClient({ baseUrl: this.opts.cfg.yemot.apiBaseUrl })
      const r = await bootstrapExtension(client, {
        username: this.opts.cfg.yemot.username,
        password: this.opts.cfg.yemot.password,
        extensionNumber: this.opts.cfg.yemot.extensionNumber,
        extensionTitle: this.opts.cfg.yemot.extensionTitle,
        publicBaseUrl: this.opts.cfg.server.publicBaseUrl,
        webhookPath: this.opts.cfg.server.webhookPath,
        sharedSecret: this.opts.cfg.server.sharedSecret,
      })
      if (r.ok) {
        this.bootstrapStatus = 'ok'
        this.logger.info('extension bootstrapped', { apiLink: r.resolvedApiLink, fellBackToApiUrl: r.fellBackToApiUrl })
        this.opts.onEvent?.({
          type: 'extension.configured',
          apiLink: r.resolvedApiLink!,
          extensionNumber: this.opts.cfg.yemot.extensionNumber,
        })
      } else {
        this.bootstrapStatus = 'failed'
        this.bootstrapError = r.error?.message
        this.logger.error('extension bootstrap failed', { error: r.error?.message, attempts: r.attempts })
      }
    } catch (e) {
      this.bootstrapStatus = 'failed'
      this.bootstrapError = (e as Error).message
      this.logger.error('extension bootstrap threw', { error: (e as Error).message })
    }
  }

  async stop(): Promise<void> {
    if (!this.server) return
    // For each active session, signal abort so in-flight agent calls terminate.
    for (const s of this.registry.list()) {
      s.abort('shutdown')
    }
    await new Promise<void>(resolve => {
      this.server!.close(() => resolve())
      // Give it 30s; close() callback fires once all connections drain.
      setTimeout(resolve, 30_000)
    })
    this.listening = false
    this.server = undefined
  }

  state(): ServiceState {
    return {
      listening: this.listening,
      port: this.actualPort,
      baseUrl: this.opts.cfg.server.publicBaseUrl,
      activeCallCount: this.registry.size(),
      version: VERSION,
      bootstrapStatus: this.bootstrapStatus,
      bootstrapError: this.bootstrapError,
      lastAuthFailureAt: this.lastAuthFailureAt,
    }
  }

  list(): Array<{ callId: string; phone: string; did: string; startedAt: number; lastTurnAt: number; transcriptLength: number }> {
    return this.registry.list().map(s => ({
      callId: s.state.callId,
      phone: s.state.phone,
      did: s.state.did,
      startedAt: s.state.startedAt,
      lastTurnAt: s.state.lastTurnAt,
      transcriptLength: s.state.transcript.length,
    }))
  }

  endCall(callId: string): boolean {
    const s = this.registry.get(callId)
    if (!s) return false
    s.abort('manual')
    return true
  }
}
