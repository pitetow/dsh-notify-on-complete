/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { createNotifyApiHandler } from './api.js'
import { blockedBody, buildBody, buildCommands, buildSoundCommands, isSupportedPlatform, resolveSoundName, resultText, soundKeyFor, spawnNotify } from './notify.js'
import { isInQuietHours } from './quiet-hours.js'
import { BlockedNotifier, RunEndNotifier } from './notifier.js'
import { installNotifySettings } from './settings.js'
import type { AgentStatusPayload, NotifyConfig, Session, SessionEvent } from './types.js'

export const name = 'dsh-notify-on-complete'

/**
 * Notify the OS when a root-session run ends. Watches `agent/status` for the
 * root agent returning to `'idle'` (the harness's run-ended signal) and
 * reports the latest `turn/end` reason recorded on `session/event`, so a run
 * spanning many turns (goal rounds, follow-ups) produces exactly one
 * notification with its true final result. Subagent sessions are excluded via
 * `header.origin === 'subagent'`.
 *
 * Config validation fails loud at load time; `enabled: false` registers
 * nothing; unsupported platforms are skipped with a warning instead of
 * throwing inside event listeners. Blocking interactions (questions and
 * approvals) during a session also fire an immediate notification.
 * @param ctx - the plugin context.
 * @param config - optional { enabled?, title?, sound?, sounds?, quietHours?, onBlocked?, onQuestion?, onApproval? }.
 */
export function apply(ctx: Context, config: NotifyConfig = {}): void {
  // Entry-config validation stays fail-loud for profiles without a settings
  // service; the settings panel validates its own writes via the schema.
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
    throw new Error(`dsh-notify-on-complete: config.enabled must be a boolean, got ${typeof config.enabled}`)
  }
  if (config.title !== undefined && typeof config.title !== 'string') {
    throw new Error(`dsh-notify-on-complete: config.title must be a string, got ${typeof config.title}`)
  }
  if (config.sound !== undefined && typeof config.sound !== 'boolean') {
    throw new Error(`dsh-notify-on-complete: config.sound must be a boolean, got ${typeof config.sound}`)
  }
  for (const key of ['onBlocked', 'onQuestion', 'onApproval'] as const) {
    if (config[key] !== undefined && typeof config[key] !== 'boolean') {
      throw new Error(`dsh-notify-on-complete: config.${key} must be a boolean, got ${typeof config[key]}`)
    }
  }
  if (config.quietHours !== undefined && (!Array.isArray(config.quietHours) || !config.quietHours.every((range) => typeof range === 'string'))) {
    throw new Error(`dsh-notify-on-complete: config.quietHours must be an array of strings, got ${typeof config.quietHours}`)
  }

  // The authoritative value: settings panel user layer > entry config > defaults.
  let current: NotifyConfig = config
  installNotifySettings(ctx, config, (value) => { current = value })

  // The browser settings card reads and writes through this route: the
  // harness's settings API serves only an explicit allowlist to the web
  // client, so the plugin exposes its own config JSON route instead. The
  // webServer service mounts after this bundle in web profiles, so wait on
  // the service rather than reading it at apply time; CLI one-shot runs never
  // satisfy the injection and the route simply never registers.
  ctx.inject(['webServer'], (sctx) => {
    const webServer = sctx.get('webServer') as { register(route: {
      kind: 'prefix'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    }): () => void }
    sctx.effect(
      () => webServer.register({
        kind: 'prefix',
        path: '/notify-on-complete/api',
        handler: createNotifyApiHandler(ctx),
      }),
      'dsh-notify-on-complete: settings api route',
    )
  })

  if (!(current.enabled ?? true)) return

  if (!isSupportedPlatform(process.platform)) {
    ctx.logger?.warn?.(`dsh-notify-on-complete: unsupported platform "${process.platform}" — notifications disabled`)
    return
  }

  /** Suppressed during quiet hours and when disabled. */
  const active = (): boolean => (current.enabled ?? true) && !isInQuietHours(new Date(), current.quietHours ?? [])

  const notifier = new RunEndNotifier({
    notify: (kind: string, sessionId: string, sessionTitle: string): void => {
      if (!active()) return
      const soundName = resolveSoundName(current.sounds, soundKeyFor(kind))
      spawnNotify(buildCommands(process.platform, current.title ?? 'DeepSeek Harness', buildBody(resultText(kind), sessionId, sessionTitle), soundName, current.sound ?? true))
      if (current.sound ?? true) spawnNotify(buildSoundCommands(process.platform, soundName))
    },
  })

  const blockedNotifier = new BlockedNotifier({
    notify: (kind: string, detail: string, sessionId: string, sessionTitle: string): void => {
      if (!(current.onBlocked ?? true)) return
      if (kind === 'question' && !(current.onQuestion ?? true)) return
      if (kind === 'approval' && !(current.onApproval ?? true)) return
      if (!active()) return
      const soundName = resolveSoundName(current.sounds, soundKeyFor(kind))
      spawnNotify(buildCommands(process.platform, current.title ?? 'DeepSeek Harness', blockedBody(kind, detail, sessionId, sessionTitle), soundName, current.sound ?? true))
      if (current.sound ?? true) spawnNotify(buildSoundCommands(process.platform, soundName))
    },
    onQuestion: true,
    onApproval: true,
  })
  // The actual switches are judged dynamically inside the callback from
  // `current`, so the constructor flags stay all-on.

  // The harness's typed `session/event` and `agent/status` declarations live in
  // the unpublished @deepseek-ai/dsh-session / @deepseek-ai/dsh-agent packages,
  // so register with a narrowed cast; the payload shapes are pinned
  // structurally in types.ts.
  const register = ctx.on as unknown as (
    name: string,
    listener: (...args: unknown[]) => void,
  ) => () => void
  register('session/event', (...args: unknown[]): void => {
    const session = args[0] as Session
    const event = args[1] as SessionEvent
    notifier.onSessionEvent(session, event)
    blockedNotifier?.onSessionEvent(session, event)
  })
  register('agent/status', (...args: unknown[]): void => {
    notifier.onAgentStatus(args[0] as AgentStatusPayload)
  })
}
