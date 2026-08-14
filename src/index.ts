/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import type { Context } from '@deepseek-ai/cordis'
import { blockedBody, buildBody, buildCommands, buildSoundCommands, isSupportedPlatform, resultText, spawnNotify } from './notify.js'
import { BlockedNotifier, RunEndNotifier } from './notifier.js'
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
 * @param config - optional { enabled?, title?, sound?, onBlocked?, onQuestion?, onApproval? }.
 */
export function apply(ctx: Context, config: NotifyConfig = {}): void {
  const enabled = config.enabled ?? true
  const title = config.title ?? 'DeepSeek Harness'
  if (typeof enabled !== 'boolean') {
    throw new Error(`dsh-notify-on-complete: config.enabled must be a boolean, got ${typeof enabled}`)
  }
  if (typeof title !== 'string') {
    throw new Error(`dsh-notify-on-complete: config.title must be a string, got ${typeof title}`)
  }
  const sound = config.sound ?? true
  if (typeof sound !== 'boolean') {
    throw new Error(`dsh-notify-on-complete: config.sound must be a boolean, got ${typeof sound}`)
  }
  const onBlocked = config.onBlocked ?? true
  if (typeof onBlocked !== 'boolean') {
    throw new Error(`dsh-notify-on-complete: config.onBlocked must be a boolean, got ${typeof onBlocked}`)
  }
  const onQuestion = config.onQuestion ?? true
  if (typeof onQuestion !== 'boolean') {
    throw new Error(`dsh-notify-on-complete: config.onQuestion must be a boolean, got ${typeof onQuestion}`)
  }
  const onApproval = config.onApproval ?? true
  if (typeof onApproval !== 'boolean') {
    throw new Error(`dsh-notify-on-complete: config.onApproval must be a boolean, got ${typeof onApproval}`)
  }
  if (!enabled) return

  if (!isSupportedPlatform(process.platform)) {
    ctx.logger?.warn?.(`dsh-notify-on-complete: unsupported platform "${process.platform}" — notifications disabled`)
    return
  }

  const notifier = new RunEndNotifier({
    notify: (kind: string, sessionId: string, sessionTitle: string): void => {
      spawnNotify(buildCommands(process.platform, title, buildBody(resultText(kind), sessionId, sessionTitle)))
      if (sound) spawnNotify(buildSoundCommands(process.platform))
    },
  })

  const blockedNotifier = onBlocked ? new BlockedNotifier({
    notify: (kind: string, detail: string, sessionId: string, sessionTitle: string): void => {
      spawnNotify(buildCommands(process.platform, title, blockedBody(kind, detail, sessionId, sessionTitle)))
      if (sound) spawnNotify(buildSoundCommands(process.platform))
    },
    onQuestion,
    onApproval,
  }) : undefined

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
