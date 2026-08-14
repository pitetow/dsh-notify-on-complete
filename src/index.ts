import type { Context } from '@deepseek-ai/cordis'
import { buildBody, buildCommands, resultText, spawnNotify } from './notify.js'
import type { NotifyConfig, Session, SessionEvent, TurnEndData } from './types.js'

export const name = 'dsh-notify-on-complete'

/**
 * Notify the OS when a root-session run ends. Listens to `session/event`,
 * filters `turn/end` on root sessions (subagent sessions carry a
 * `parentSession` header), and fire-and-forgets a platform notification.
 * Config validation fails loud at load time; `enabled: false` registers nothing.
 * @param ctx - the plugin context.
 * @param config - optional `{ enabled?, title? }`.
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
  if (!enabled) return

  const onSessionEvent = (session: Session, event: SessionEvent): void => {
    if (event.type !== 'turn/end') return
    if (session.header.parentSession !== undefined) return
    const data = event.data as TurnEndData
    spawnNotify(buildCommands(process.platform, title, buildBody(resultText(data.reason.kind), session.header.id)))
  }
  // The harness's typed `session/event` declaration lives in the unpublished
  // @deepseek-ai/dsh-session package chain, so register with a narrowed cast;
  // the payload shapes are pinned structurally in types.ts.
  const register = ctx.on as unknown as (
    name: string,
    listener: (session: Session, event: SessionEvent) => void,
  ) => () => void
  register('session/event', onSessionEvent)
}
