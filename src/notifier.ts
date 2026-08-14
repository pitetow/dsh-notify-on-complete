/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import type { AgentStatusPayload, Session, SessionEvent } from './types.js'

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
    notify: (kind: string, sessionId: string) => unknown
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
    this.deps.notify(kind, sessionId)
  }
}
