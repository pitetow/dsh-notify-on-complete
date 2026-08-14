/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'

const mockChild = vi.hoisted(() => {
  const children: Array<{ unref: ReturnType<typeof vi.fn>; errorHandlers: Array<(e: NodeJS.ErrnoException) => void> }> = []
  return {
    children,
    makeChild: () => {
      const child = { unref: vi.fn(), errorHandlers: [] as Array<(e: NodeJS.ErrnoException) => void> }
      children.push(child)
      return {
        once: vi.fn((event: string, handler: (error: unknown) => void) => {
          if (event === 'error') child.errorHandlers.push(handler as (e: NodeJS.ErrnoException) => void)
        }),
        unref: child.unref,
      }
    },
  }
})

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockChild.makeChild()),
}))

import { apply } from '../src/index.js'
import type { NotifyConfig } from '../src/types.js'

const mockedSpawn = vi.mocked(spawn)

interface MockCtx {
  logger: { warn: ReturnType<typeof vi.fn> }
  on: ReturnType<typeof vi.fn>
  emit: (name: string, ...args: unknown[]) => void
}

function mockCtx(): MockCtx {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const ctx: MockCtx = {
    logger: { warn: vi.fn() },
    on: vi.fn((name: string, listener: (...args: unknown[]) => void) => {
      const arr = listeners.get(name) ?? []
      arr.push(listener)
      listeners.set(name, arr)
      return () => undefined
    }),
    emit: (name: string, ...args: unknown[]) => {
      for (const listener of listeners.get(name) ?? []) listener(...args)
    },
  }
  return ctx
}

function rootTurnEnd(kind: string): unknown[] {
  return [{ header: { id: 'root' } }, { type: 'turn/end', data: { turn: 1, reason: { kind } } }]
}

function subagentTurnEnd(kind: string): unknown[] {
  return [{ header: { id: 'child', origin: 'subagent' } }, { type: 'turn/end', data: { turn: 1, reason: { kind } } }]
}

function idleRoot(): unknown[] {
  return [{ status: 'idle', agent: { id: 'root', session: { header: { id: 'root' } } } }]
}

function idleSubagent(): unknown[] {
  return [{ status: 'idle', agent: { id: 'child', session: { header: { id: 'child', origin: 'subagent' } } } }]
}

function rootToolCall(name: string, args = '{}'): unknown[] {
  return [{ header: { id: 'root' } }, { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name, arguments: args } }]
}

function rootApprovalAsked(toolName: string, reason?: string): unknown[] {
  return [{ header: { id: 'root' } }, { type: 'approval/asked', data: { id: 'a1', toolName, ...(reason === undefined ? {} : { reason }) } }]
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

afterEach(() => {
  mockedSpawn.mockClear()
  mockChild.children.length = 0
  Object.defineProperty(process, 'platform', originalPlatform!)
})

describe('apply', () => {
  it('registers both listeners and notifies once per run on a supported platform', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx, { title: 'T' })

    expect(ctx.on).toHaveBeenCalledWith('session/event', expect.any(Function))
    expect(ctx.on).toHaveBeenCalledWith('agent/status', expect.any(Function))

    // A multi-turn run: two rounds end, then the agent returns to idle.
    ctx.emit('session/event', ...rootTurnEnd('completed'))
    ctx.emit('session/event', ...rootTurnEnd('completed'))
    ctx.emit('agent/status', ...idleRoot())

    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    expect(mockedSpawn).toHaveBeenCalledWith('osascript', [
      '-e',
      'display notification "任务已完成 (session: root)" with title "T" sound name "Glass"',
    ], { detached: true, stdio: 'ignore' })
  })

  it('reports the failing kind of the last turn end-to-end', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('session/event', ...rootTurnEnd('completed'))
    ctx.emit('session/event', ...rootTurnEnd('error'))
    ctx.emit('agent/status', ...idleRoot())
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).toContain('任务失败 (session: root)')
  })

  it('maps unknown kinds to the generic end text end-to-end', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('session/event', ...rootTurnEnd('blocked'))
    ctx.emit('agent/status', ...idleRoot())
    expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).toContain('任务结束 (session: root)')
  })

  it('never notifies subagent sessions end-to-end', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('session/event', ...subagentTurnEnd('completed'))
    ctx.emit('agent/status', ...idleSubagent())
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  it('does not notify without a turn ending even when the agent idles', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('agent/status', ...idleRoot())
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  it('registers nothing when disabled', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx, { enabled: false })
    expect(ctx.on).not.toHaveBeenCalled()
  })

  it('fails loud on a non-boolean enabled', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    expect(() => apply(ctx, { enabled: 1 as unknown as boolean })).toThrow(/config\.enabled must be a boolean/)
  })

  it('fails loud on a non-string title', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    expect(() => apply(ctx, { title: 1 as unknown as NotifyConfig['title'] })).toThrow(/config\.title must be a string/)
  })

  it('skips unsupported platforms with a warning instead of registering', () => {
    setPlatform('freebsd')
    const ctx = mockCtx()
    expect(() => apply(ctx)).not.toThrow()
    expect(ctx.on).not.toHaveBeenCalled()
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('unsupported platform'))
  })

  it('spawns the Linux sound command in addition to the notification', () => {
    setPlatform('linux')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('session/event', ...rootTurnEnd('completed'))
    ctx.emit('agent/status', ...idleRoot())
    expect(mockedSpawn).toHaveBeenCalledTimes(2)
    expect(mockedSpawn.mock.calls[1]![0]).toBe('canberra-gtk-play')
  })

  it('skips the sound when config.sound is false', () => {
    setPlatform('linux')
    const ctx = mockCtx()
    apply(ctx, { sound: false })
    ctx.emit('session/event', ...rootTurnEnd('completed'))
    ctx.emit('agent/status', ...idleRoot())
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    expect(mockedSpawn.mock.calls[0]![0]).toBe('notify-send')
  })

  it('fails loud on a non-boolean sound', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    expect(() => apply(ctx, { sound: 1 as unknown as NotifyConfig['sound'] })).toThrow(/config\.sound must be a boolean/)
  })

  it('notifies immediately on an ask_user_question tool call', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('session/event', ...rootToolCall('ask_user_question', '{"questions":[{"question":"要如何？"}]}'))
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).toContain('需要回答：要如何？ (session: root)')
  })

  it('notifies immediately on an approval/asked event', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('session/event', ...rootApprovalAsked('bash', 'escalate sandbox'))
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).toContain('需要批准：bash — escalate sandbox (session: root)')
  })

  it('does not notify blocked events for subagent sessions', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('session/event', { header: { id: 'child', origin: 'subagent' } }, { type: 'tool/call', data: { name: 'ask_user_question', arguments: '{}' } })
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  it('disables blocked notifications when onBlocked is false', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx, { onBlocked: false })
    ctx.emit('session/event', ...rootToolCall('ask_user_question', '{"questions":[{"question":"x"}]}'))
    ctx.emit('session/event', ...rootApprovalAsked('bash'))
    expect(mockedSpawn).not.toHaveBeenCalled()
    // The master switch scopes only to blocked notifications: run-ended still fires.
    ctx.emit('session/event', ...rootTurnEnd('completed'))
    ctx.emit('agent/status', ...idleRoot())
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).toContain('任务已完成 (session: root)')
  })

  it('fires a blocked notification and a run-ended notification without interfering', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('session/event', ...rootToolCall('ask_user_question', '{"questions":[{"question":"要如何？"}]}'))
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    ctx.emit('session/event', ...rootTurnEnd('completed'))
    ctx.emit('agent/status', ...idleRoot())
    expect(mockedSpawn).toHaveBeenCalledTimes(2)
    expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).toContain('需要回答：要如何？')
    expect(mockedSpawn.mock.calls[1]![1]!.join(' ')).toContain('任务已完成')
  })

  it('disables only questions when onQuestion is false', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx, { onQuestion: false })
    ctx.emit('session/event', ...rootToolCall('ask_user_question', '{"questions":[{"question":"x"}]}'))
    expect(mockedSpawn).not.toHaveBeenCalled()
    ctx.emit('session/event', ...rootApprovalAsked('bash'))
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
  })

  it('disables only approvals when onApproval is false', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx, { onApproval: false })
    ctx.emit('session/event', ...rootApprovalAsked('bash'))
    expect(mockedSpawn).not.toHaveBeenCalled()
    ctx.emit('session/event', ...rootToolCall('ask_user_question', '{"questions":[{"question":"x"}]}'))
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
  })

  it('fails loud on non-boolean onBlocked/onQuestion/onApproval', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    expect(() => apply(ctx, { onBlocked: 1 as unknown as NotifyConfig['onBlocked'] })).toThrow(/config\.onBlocked must be a boolean/)
    expect(() => apply(ctx, { onQuestion: 1 as unknown as NotifyConfig['onQuestion'] })).toThrow(/config\.onQuestion must be a boolean/)
    expect(() => apply(ctx, { onApproval: 1 as unknown as NotifyConfig['onApproval'] })).toThrow(/config\.onApproval must be a boolean/)
  })
})
