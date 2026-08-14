/**
 * Structural event types for the harness `session/event` feed.
 * Deliberately minimal: only the fields this plugin reads, so the plugin does
 * not need the harness's internal packages at runtime.
 * @module dsh-notify-on-complete/types
 */

/** The `turn/end` reason kinds the harness agent loop writes. */
export type TurnEndKind = 'completed' | 'error' | 'aborted' | 'max-tokens'

/** The `turn/end` session event payload as appended by the agent loop. */
export interface TurnEndData {
  turn: number
  reason: { kind: TurnEndKind } & Record<string, unknown>
}

/** A session event as delivered to `session/event` listeners. */
export interface SessionEvent {
  type: string
  data: unknown
}

/** The session header fields this plugin reads. */
export interface SessionHeader {
  id: string
  parentSession?: string
}

/** The session object delivered to `session/event` listeners. */
export interface Session {
  header: SessionHeader
}

/** Plugin config: `enabled` and `title`, both optional with defaults. */
export interface NotifyConfig {
  enabled?: boolean
  title?: string
}
