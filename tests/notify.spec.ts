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

import { buildBody, buildCommands, buildSoundCommands, isSupportedPlatform, resultText, spawnNotify } from '../src/notify.js'

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
