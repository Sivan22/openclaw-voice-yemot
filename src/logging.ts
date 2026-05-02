export interface PluginLogger {
  debug(msg: string, ctx?: Record<string, unknown>): void
  info(msg: string, ctx?: Record<string, unknown>): void
  warn(msg: string, ctx?: Record<string, unknown>): void
  error(msg: string, ctx?: Record<string, unknown>): void
}

export const consoleLogger: PluginLogger = {
  debug(msg, ctx) { console.debug(`[voice-yemot] ${msg}`, ctx ?? '') },
  info(msg, ctx)  { console.info (`[voice-yemot] ${msg}`, ctx ?? '') },
  warn(msg, ctx)  { console.warn (`[voice-yemot] ${msg}`, ctx ?? '') },
  error(msg, ctx) { console.error(`[voice-yemot] ${msg}`, ctx ?? '') },
}

/**
 * Wrap an OpenClaw `api.logger` (whose exact shape is plugin-API-version-dependent)
 * into the addin's PluginLogger interface. If passed undefined, returns consoleLogger.
 */
export function wrapHostLogger(host: unknown): PluginLogger {
  if (host && typeof host === 'object' && 'info' in host && 'error' in host) {
    return host as PluginLogger
  }
  return consoleLogger
}
