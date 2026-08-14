/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { approvalDetail, blockedQuestionText, sessionTitle } from './notify.js'
import type { AgentStatusPayload, ApprovalAskedData, Session, SessionEvent, ToolCallData } from './types.js'

/**
 * Tracks root-session turn endings and reports the run's final result exactly
 * once, when the agent returns to idle.
 *
 * Why not notify on `turn/end` directly? A "run" can span many turns: a goal
 * run queues one round per turn, and each round's `turn/end` carries the same
 * `completed` kind. Notifying per turn would spam one notification per round
 * and announce "任务已完成" while the run is still going. The harness itself
 * treats `agent/status` `'idle'` as the run-ended signal (the web host flips
 * its running indicator on it, and `whenIdle()` resolves on quiescence), so
 * this notifier waits for idle and reports the *latest* recorded `turn/end`
 * reason — one notification per run, with the true final result.
 *
 * Subagent sessions are excluded on both paths via the harness's own idiom
 * (`header.origin === 'subagent'`), not `parentSession`, which also marks
 * fork lineage and would wrongly silence forked/resumed root sessions.
 */
export class RunEndNotifier {
  /** Latest `turn/end` reason kind per root session id, consumed at idle. */
  private readonly reasons = new Map<string, string>()

  constructor(private readonly deps: {
    /** Emit one notification for a finished root run. */
    notify: (kind: string, sessionId: string, sessionTitle: string) => unknown
  }) {}

  /** Feed `session/event`; records the latest reason kind of root-session turn endings. */
  onSessionEvent(session: Session, event: SessionEvent): void {
    if (event.type !== 'turn/end') return
    if (session.header.origin === 'subagent') return
    const data = event.data as { reason?: { kind?: unknown } } | undefined
    const kind = typeof data?.reason?.kind === 'string' ? data.reason.kind : 'unknown'
    this.reasons.set(session.header.id, kind)
  }

  /** Feed `agent/status`; on `'idle'` for a root agent, report the recorded result once. */
  onAgentStatus(payload: AgentStatusPayload): void {
    if (payload.status !== 'idle') return
    const agent = payload.agent
    const sessionId = agent?.id ?? agent?.session?.header?.id
    if (typeof sessionId !== 'string') return
    if (agent?.session?.header?.origin === 'subagent') return
    const kind = this.reasons.get(sessionId)
    if (kind === undefined) return // no turn ended in this activity — nothing to report
    this.reasons.delete(sessionId)
    this.deps.notify(kind, sessionId, sessionTitle(agent?.session?.events ?? []))
  }
}

/**
 * Fires one notification per blocking user-interaction as it happens: a
 * question (`tool/call` naming `ask_user_question`) or an approval ask
 * (`approval/asked`). Unlike {@link RunEndNotifier}, it reports immediately on
 * each event — no aggregation — because each ask is a separate "the session is
 * waiting on the user" moment. Subagent sessions are excluded via
 * `header.origin === 'subagent'`, and the `onQuestion` / `onApproval` switches
 * let the plugin turn one class off without touching the other.
 */
export class BlockedNotifier {
  constructor(private readonly deps: {
    /** Emit one notification for a blocking action. */
    notify: (kind: string, detail: string, sessionId: string, sessionTitle: string) => unknown
    onQuestion: boolean
    onApproval: boolean
  }) {}

  /** Feed `session/event`; report blocking interactions on root sessions only. */
  onSessionEvent(session: Session, event: SessionEvent): void {
    if (session.header.origin === 'subagent') return
    if (event.type === 'tool/call' && this.deps.onQuestion) {
      const data = event.data as ToolCallData | undefined
      if (data?.name !== 'ask_user_question') return
      const detail = typeof data.arguments === 'string' ? blockedQuestionText(data.arguments) : ''
      this.deps.notify('question', detail, session.header.id, sessionTitle(session.events ?? []))
    } else if (event.type === 'approval/asked' && this.deps.onApproval) {
      const data = event.data as ApprovalAskedData | undefined
      const toolName = typeof data?.toolName === 'string' ? data.toolName : ''
      const reason = typeof data?.reason === 'string' ? data.reason : ''
      this.deps.notify('approval', approvalDetail(toolName, reason), session.header.id, sessionTitle(session.events ?? []))
    }
  }
}
