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

import { approvalDetail, blockedBody, blockedQuestionText, buildBody, buildCommands, buildSoundCommands, isSupportedPlatform, resultText, sessionTitle, spawnNotify } from '../src/notify.js'

const mockedSpawn = vi.mocked(spawn)

afterEach(() => {
  mockedSpawn.mockClear()
  mockChild.children.length = 0
})

describe('resultText', () => {
  it('maps every known turn-end reason kind', () => {
    expect(resultText('completed')).toBe('任务已完成')
    expect(resultText('error')).toBe('任务失败')
    expect(resultText('aborted')).toBe('任务已中止')
    expect(resultText('max-tokens')).toBe('任务达到 token 上限')
  })

  it('falls back to a generic end text for unknown kinds', () => {
    expect(resultText('future-kind')).toBe('任务结束')
  })
})

describe('buildBody', () => {
  it('appends the session id', () => {
    expect(buildBody('任务已完成', 'abc-123')).toBe('任务已完成 (session: abc-123)')
  })

  it('inserts the title between the result and the session id', () => {
    expect(buildBody('任务已完成', 'abc-123', '修复登录bug')).toBe('任务已完成 — 修复登录bug (session: abc-123)')
  })
})

describe('buildCommands', () => {
  it('builds the macOS osascript command', () => {
    const [cmd] = buildCommands('darwin', 'DeepSeek Harness', '任务已完成 (session: a)')
    expect(cmd.command).toBe('osascript')
    expect(cmd.args).toEqual([
      '-e',
      'display notification "任务已完成 (session: a)" with title "DeepSeek Harness" sound name "Glass"',
    ])
  })

  it('escapes backslashes and quotes for AppleScript', () => {
    const [cmd] = buildCommands('darwin', 'Title "x"', 'Body \\ y')
    expect(cmd.args[1]).toBe('display notification "Body \\\\ y" with title "Title \\"x\\"" sound name "Glass"')
  })

  it('escapes control characters for AppleScript (no raw newlines in literals)', () => {
    const [cmd] = buildCommands('darwin', 'T', 'Line1\nLine2\tTab\rRet')
    expect(cmd.args[1]).toBe('display notification "Line1\\nLine2\\tTab\\rRet" with title "T" sound name "Glass"')
  })

  it('builds Linux notify-send with a kdialog fallback', () => {
    expect(buildCommands('linux', 'T', 'B')).toEqual([
      { command: 'notify-send', args: ['T', 'B'] },
      { command: 'kdialog', args: ['--passivepopup', 'B', 'T', '5'] },
    ])
  })

  it('builds the Windows PowerShell popup and escapes single quotes', () => {
    const [cmd] = buildCommands('win32', 'T', "B'x")
    const joined = cmd.args.join(' ')
    expect(cmd.command).toBe('powershell')
    expect(joined).toContain("$ws.Popup('B''x', 5, 'T', 64)")
    expect(joined).toContain('[System.Media.SystemSounds]::Asterisk.Play()')
    expect(joined.indexOf('[System.Media.SystemSounds]::Asterisk.Play()')).toBeLessThan(joined.indexOf('$ws.Popup('))
  })

  it('throws on unsupported platforms', () => {
    expect(() => buildCommands('aix' as NodeJS.Platform, 'T', 'B')).toThrow(/unsupported platform/)
  })
})

describe('isSupportedPlatform', () => {
  it('accepts the three supported platforms', () => {
    expect(isSupportedPlatform('darwin')).toBe(true)
    expect(isSupportedPlatform('linux')).toBe(true)
    expect(isSupportedPlatform('win32')).toBe(true)
  })

  it('rejects everything else', () => {
    for (const platform of ['aix', 'freebsd', 'sunos', 'android', 'cygwin'] as NodeJS.Platform[]) {
      expect(isSupportedPlatform(platform)).toBe(false)
    }
  })
})

describe('buildSoundCommands', () => {
  it('returns the canberra → paplay fallback chain on linux', () => {
    expect(buildSoundCommands('linux')).toEqual([
      { command: 'canberra-gtk-play', args: ['-i', 'complete'] },
      { command: 'paplay', args: ['/usr/share/sounds/freedesktop/stereo/complete.oga'] },
    ])
  })

  it('returns an empty chain on platforms whose notification command embeds the sound', () => {
    expect(buildSoundCommands('darwin')).toEqual([])
    expect(buildSoundCommands('win32')).toEqual([])
    // Never throws, even on unsupported platforms — callers rely on the empty chain.
    expect(buildSoundCommands('aix' as NodeJS.Platform)).toEqual([])
  })
})

describe('spawnNotify', () => {
  it('spawns the first candidate detached and unrefs the child', () => {
    const child = spawnNotify([{ command: 'notify-send', args: ['T', 'B'] }])
    expect(mockedSpawn).toHaveBeenCalledWith('notify-send', ['T', 'B'], { detached: true, stdio: 'ignore' })
    expect(child?.unref).toHaveBeenCalled()
  })

  it('falls back to the next candidate on ENOENT', () => {
    spawnNotify([
      { command: 'notify-send', args: ['T', 'B'] },
      { command: 'kdialog', args: ['--passivepopup', 'B', 'T', '5'] },
    ])
    mockChild.children[0]!.errorHandlers[0]!(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    expect(mockedSpawn).toHaveBeenCalledTimes(2)
    expect(mockedSpawn).toHaveBeenLastCalledWith('kdialog', ['--passivepopup', 'B', 'T', '5'], { detached: true, stdio: 'ignore' })
  })

  it('does not retry on a non-ENOENT error', () => {
    spawnNotify([
      { command: 'notify-send', args: ['T', 'B'] },
      { command: 'kdialog', args: ['--passivepopup', 'B', 'T', '5'] },
    ])
    mockChild.children[0]!.errorHandlers[0]!(Object.assign(new Error('denied'), { code: 'EACCES' }))
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
  })

  it('returns undefined when no candidate remains', () => {
    expect(spawnNotify([])).toBeUndefined()
    expect(mockedSpawn).not.toHaveBeenCalled()
  })
})

describe('blockedQuestionText', () => {
  it('extracts the first question text', () => {
    expect(blockedQuestionText('{"questions":[{"id":"a","question":"要如何？"},{"id":"b","question":"第二个"}]}')).toBe('要如何？')
  })

  it('truncates long questions to 80 chars with an ellipsis', () => {
    const long = '问'.repeat(100)
    expect(blockedQuestionText(`{"questions":[{"question":"${long}"}]}`)).toBe(`${'问'.repeat(80)}…`)
  })

  it('does not truncate a question of exactly 80 chars', () => {
    const exact = '问'.repeat(80)
    expect(blockedQuestionText(`{"questions":[{"question":"${exact}"}]}`)).toBe(exact)
  })

  it('trims leading and trailing whitespace', () => {
    expect(blockedQuestionText('{"questions":[{"question":"  要如何？  "}]}')).toBe('要如何？')
  })

  it('does not split a surrogate pair at the truncation boundary', () => {
    const text = 'a'.repeat(79) + '😀'
    expect(blockedQuestionText(`{"questions":[{"question":"${text}"}]}`)).toBe(text)
  })

  it('returns an empty string on invalid JSON', () => {
    expect(blockedQuestionText('not json')).toBe('')
  })

  it('returns an empty string when questions are missing or malformed', () => {
    expect(blockedQuestionText('{"questions":[]}')).toBe('')
    expect(blockedQuestionText('{"questions":[{"id":"a"}]}')).toBe('')
    expect(blockedQuestionText('{"questions":[{"question":""}]}')).toBe('')
    expect(blockedQuestionText('{"questions":[{"question":123}]}')).toBe('')
  })
})

describe('blockedBody', () => {
  it('builds the question body', () => {
    expect(blockedBody('question', '要如何？', 'root')).toBe('需要回答：要如何？ (session: root)')
  })

  it('builds the approval body', () => {
    expect(blockedBody('approval', 'bash — escalate', 'root')).toBe('需要批准：bash — escalate (session: root)')
  })

  it('falls back to the generic text when detail is empty', () => {
    expect(blockedBody('question', '', 'root')).toBe('需要处理 (session: root)')
  })

  it('falls back to the generic text for an unknown kind', () => {
    expect(blockedBody('future-kind', 'x', 'root')).toBe('需要处理 (session: root)')
  })

  it('inserts the title between the body and the session id', () => {
    expect(blockedBody('question', '要如何？', 'root', '修复登录bug')).toBe('需要回答：要如何？ — 修复登录bug (session: root)')
  })
})

describe('sessionTitle', () => {
  it('reads the latest session/title event', () => {
    const events = [
      { type: 'session/title', data: { title: 'first' } },
      { type: 'assistant/message', data: {} },
      { type: 'session/title', data: { title: 'second' } },
    ]
    expect(sessionTitle(events)).toBe('second')
  })

  it('returns an empty string without any title event', () => {
    expect(sessionTitle([{ type: 'assistant/message', data: {} }])).toBe('')
    expect(sessionTitle([])).toBe('')
  })

  it('returns an empty string for a non-string or blank title', () => {
    expect(sessionTitle([{ type: 'session/title', data: { title: 123 } }])).toBe('')
    expect(sessionTitle([{ type: 'session/title', data: { title: '   ' } }])).toBe('')
  })

  it('truncates a long title to 80 chars', () => {
    const long = '题'.repeat(100)
    expect(sessionTitle([{ type: 'session/title', data: { title: long } }])).toBe(`${'题'.repeat(80)}…`)
  })
})

describe('approvalDetail', () => {
  it('joins the tool name and reason with an em dash', () => {
    expect(approvalDetail('bash', 'escalate')).toBe('bash — escalate')
  })

  it('returns the tool name alone when the reason is empty', () => {
    expect(approvalDetail('bash', '')).toBe('bash')
  })

  it('returns an empty string when the tool name is empty', () => {
    expect(approvalDetail('', 'escalate')).toBe('')
  })
})
