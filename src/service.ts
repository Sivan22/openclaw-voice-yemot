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
      // Lazy import to keep bootstrap off the unit-test path when auto-configure is off
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
    } else {
      this.bootstrapStatus = 'skipped'
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
