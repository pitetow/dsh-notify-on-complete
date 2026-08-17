/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
/**
 * Structural event types for the harness `session/event` feed and the
 * `agent/status` live lifecycle bus.
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

/** The `tool/call` event data fields this plugin reads. */
export interface ToolCallData {
  name?: unknown
  arguments?: unknown
}

/** The `approval/asked` event data fields this plugin reads. */
export interface ApprovalAskedData {
  toolName?: unknown
  reason?: unknown
}

/** The session header fields this plugin reads. */
export interface SessionHeader {
  id: string
  parentSession?: string
  /** Coarse product classification; subagent sessions carry `'subagent'`. */
  origin?: 'subagent'
}

/** The session object delivered to `session/event` listeners. */
export interface Session {
  header: SessionHeader
  /** The session's full event log, in order; read to find the latest title. */
  events?: readonly SessionEvent[]
}

/**
 * The `agent/status` live lifecycle payload (not a logged session event).
 * `'idle'` means the whole-agent activity reached quiescence — the run ended.
 */
export interface AgentStatusPayload {
  status: string
  agent?: {
    id?: string
    session?: Session
  }
}

/** Plugin config: all optional with defaults; settings panel overlays config. */
export interface NotifyConfig {
  enabled?: boolean
  title?: string
  /** Play a system sound alongside the notification; default `true`. */
  sound?: boolean
  /** Per-tier sound overrides (macOS sound names); defaults in DEFAULT_SOUNDS. */
  sounds?: Partial<Record<'completed' | 'error' | 'approval', string>>
  /** Quiet-hours specs "HH:MM-HH:MM" (start after end crosses midnight); empty = never quiet. */
  quietHours?: string[]
  /** Notify on blocking user-interactions (questions + approvals); default `true`. */
  onBlocked?: boolean
  /** Notify when the model asks a question (`ask_user_question`); default `true`. */
  onQuestion?: boolean
  /** Notify when the harness waits for approval; default `true`. */
  onApproval?: boolean
}
