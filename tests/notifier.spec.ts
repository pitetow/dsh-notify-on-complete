/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from 'vitest'
import { BlockedNotifier, RunEndNotifier } from '../src/notifier.js'
import type { AgentStatusPayload, Session, SessionEvent } from '../src/types.js'

function rootSession(id = 'root'): Session {
  return { header: { id } }
}

function subagentSession(id: string): Session {
  return { header: { id, origin: 'subagent' } }
}

function turnEnd(kind: string): SessionEvent {
  return { type: 'turn/end', data: { turn: 1, reason: { kind } } }
}

function toolCall(name: string, args = '{}'): SessionEvent {
  return { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name, arguments: args } }
}

function approvalAsked(toolName: string, reason?: string): SessionEvent {
  return { type: 'approval/asked', data: { id: 'a1', toolName, ...(reason === undefined ? {} : { reason }) } }
}

function makeBlockedNotifier(onQuestion = true, onApproval = true, notify = vi.fn()) {
  return { notifier: new BlockedNotifier({ notify, onQuestion, onApproval }), notify }
}

function idle(agent: AgentStatusPayload['agent']): AgentStatusPayload {
  return { status: 'idle', agent }
}

function running(agent: AgentStatusPayload['agent']): AgentStatusPayload {
  return { status: 'running', agent }
}

function makeNotifier(notify = vi.fn()): { notifier: RunEndNotifier; notify: ReturnType<typeof vi.fn> } {
  return { notifier: new RunEndNotifier({ notify }), notify }
}

describe('RunEndNotifier', () => {
  it('reports one notification per run with the final reason across many turns', () => {
    const { notifier, notify } = makeNotifier()
    notifier.onSessionEvent(rootSession(), turnEnd('completed')) // round 1
    notifier.onSessionEvent(rootSession(), turnEnd('completed')) // round 2
    notifier.onSessionEvent(rootSession(), turnEnd('completed')) // round 3
    notifier.onAgentStatus(idle({ id: 'root', session: rootSession() }))
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('completed', 'root')
  })

  it('reports the failing kind of the last turn when a later turn errors', () => {
    const { notifier, notify } = makeNotifier()
    notifier.onSessionEvent(rootSession(), turnEnd('completed'))
    notifier.onSessionEvent(rootSession(), turnEnd('error'))
    notifier.onAgentStatus(idle({ id: 'root', session: rootSession() }))
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('error', 'root')
  })

  it('reports aborted and max-tokens kinds verbatim', () => {
    for (const kind of ['aborted', 'max-tokens']) {
      const { notifier, notify } = makeNotifier()
      notifier.onSessionEvent(rootSession(), turnEnd(kind))
      notifier.onAgentStatus(idle({ id: 'root', session: rootSession() }))
      expect(notify).toHaveBeenCalledWith(kind, 'root')
    }
  })

  it('ignores intermediate turn endings — no notification before idle', () => {
    const { notifier, notify } = makeNotifier()
    notifier.onSessionEvent(rootSession(), turnEnd('completed'))
    expect(notify).not.toHaveBeenCalled()
  })

  it('ignores the running status transition', () => {
    const { notifier, notify } = makeNotifier()
    notifier.onSessionEvent(rootSession(), turnEnd('completed'))
    notifier.onAgentStatus(running({ id: 'root', session: rootSession() }))
    expect(notify).not.toHaveBeenCalled()
  })

  it('ignores non-turn/end session events', () => {
    const { notifier, notify } = makeNotifier()
    notifier.onSessionEvent(rootSession(), { type: 'assistant/message', data: {} })
    notifier.onAgentStatus(idle({ id: 'root', session: rootSession() }))
    expect(notify).not.toHaveBeenCalled()
  })

  it('does not notify subagent sessions at all', () => {
    const { notifier, notify } = makeNotifier()
    notifier.onSessionEvent(subagentSession('child'), turnEnd('completed'))
    notifier.onAgentStatus(idle({ id: 'child', session: subagentSession('child') }))
    expect(notify).not.toHaveBeenCalled()
  })

  it('does not notify when a root agent idles with no recorded turn ending', () => {
    const { notifier, notify } = makeNotifier()
    notifier.onAgentStatus(idle({ id: 'fresh', session: rootSession('fresh') }))
    expect(notify).not.toHaveBeenCalled()
  })

  it('ignores status payloads without an agent identity', () => {
    const { notifier, notify } = makeNotifier()
    notifier.onSessionEvent(rootSession(), turnEnd('completed'))
    notifier.onAgentStatus({ status: 'idle', agent: undefined })
    expect(notify).not.toHaveBeenCalled()
  })

  it('clears the recorded reason after reporting — a later idle stays silent', () => {
    const { notifier, notify } = makeNotifier()
    notifier.onSessionEvent(rootSession(), turnEnd('completed'))
    notifier.onAgentStatus(idle({ id: 'root', session: rootSession() }))
    notifier.onAgentStatus(idle({ id: 'root', session: rootSession() }))
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('falls back to the generic kind for malformed turn/end payloads', () => {
    const { notifier, notify } = makeNotifier()
    notifier.onSessionEvent(rootSession(), { type: 'turn/end', data: { turn: 1 } })
    notifier.onAgentStatus(idle({ id: 'root', session: rootSession() }))
    expect(notify).toHaveBeenCalledWith('unknown', 'root')
  })
})

describe('BlockedNotifier', () => {
  it('notifies on an ask_user_question tool call with the question text', () => {
    const { notifier, notify } = makeBlockedNotifier()
    notifier.onSessionEvent(rootSession(), toolCall('ask_user_question', '{"questions":[{"question":"要如何？"}]}'))
    expect(notify).toHaveBeenCalledWith('question', '要如何？', 'root')
  })

  it('notifies on an approval/asked event with tool name and reason', () => {
    const { notifier, notify } = makeBlockedNotifier()
    notifier.onSessionEvent(rootSession(), approvalAsked('bash', 'escalate sandbox'))
    expect(notify).toHaveBeenCalledWith('approval', 'bash — escalate sandbox', 'root')
  })

  it('omits the reason when approval/asked has none', () => {
    const { notifier, notify } = makeBlockedNotifier()
    notifier.onSessionEvent(rootSession(), approvalAsked('bash'))
    expect(notify).toHaveBeenCalledWith('approval', 'bash', 'root')
  })

  it('ignores non-ask-user tool calls', () => {
    const { notifier, notify } = makeBlockedNotifier()
    notifier.onSessionEvent(rootSession(), toolCall('bash'))
    expect(notify).not.toHaveBeenCalled()
  })

  it('ignores other event types', () => {
    const { notifier, notify } = makeBlockedNotifier()
    notifier.onSessionEvent(rootSession(), turnEnd('completed'))
    notifier.onSessionEvent(rootSession(), { type: 'assistant/message', data: {} })
    expect(notify).not.toHaveBeenCalled()
  })

  it('does not notify subagent sessions', () => {
    const { notifier, notify } = makeBlockedNotifier()
    notifier.onSessionEvent(subagentSession('child'), toolCall('ask_user_question', '{"questions":[{"question":"x"}]}'))
    notifier.onSessionEvent(subagentSession('child'), approvalAsked('bash'))
    expect(notify).not.toHaveBeenCalled()
  })

  it('respects the onQuestion and onApproval switches', () => {
    const q = makeBlockedNotifier(false, true)
    q.notifier.onSessionEvent(rootSession(), toolCall('ask_user_question', '{"questions":[{"question":"x"}]}'))
    expect(q.notify).not.toHaveBeenCalled()

    const a = makeBlockedNotifier(true, false)
    a.notifier.onSessionEvent(rootSession(), approvalAsked('bash'))
    expect(a.notify).not.toHaveBeenCalled()
  })

  it('reports an empty detail when arguments are malformed', () => {
    const { notifier, notify } = makeBlockedNotifier()
    notifier.onSessionEvent(rootSession(), toolCall('ask_user_question', 'not json'))
    expect(notify).toHaveBeenCalledWith('question', '', 'root')
  })

  it('reports an empty detail when arguments is not a string', () => {
    const { notifier, notify } = makeBlockedNotifier()
    notifier.onSessionEvent(rootSession(), { type: 'tool/call', data: { name: 'ask_user_question', arguments: 123 } })
    expect(notify).toHaveBeenCalledWith('question', '', 'root')
  })

  it('reports an empty detail when approval/asked has no tool name', () => {
    const { notifier, notify } = makeBlockedNotifier()
    notifier.onSessionEvent(rootSession(), { type: 'approval/asked', data: { id: 'a1' } })
    expect(notify).toHaveBeenCalledWith('approval', '', 'root')
  })

  it('ignores a tool/call event without data', () => {
    const { notifier, notify } = makeBlockedNotifier()
    notifier.onSessionEvent(rootSession(), { type: 'tool/call', data: undefined })
    expect(notify).not.toHaveBeenCalled()
  })
})
