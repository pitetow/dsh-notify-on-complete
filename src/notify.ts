/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { spawn } from 'node:child_process'

/** A notification command: executable + argv, spawned without a shell. */
export interface NotifyCommand {
  command: string
  args: string[]
}

/** The platforms this plugin supports; anything else is skipped with a warning. */
export const supportedPlatforms: readonly NodeJS.Platform[] = ['darwin', 'linux', 'win32']

/** Whether the platform has a notification command to run. */
export function isSupportedPlatform(platform: NodeJS.Platform): boolean {
  return supportedPlatforms.includes(platform)
}

/** Result text for a `turn/end` reason kind; unknown kinds fall through to a generic end. */
export function resultText(kind: string): string {
  switch (kind) {
    case 'completed': return '任务已完成'
    case 'error': return '任务失败'
    case 'aborted': return '任务已中止'
    case 'max-tokens': return '任务达到 token 上限'
    default: return '任务结束'
  }
}

/** Notification body: result text plus the root session id. */
export function buildBody(result: string, sessionId: string): string {
  return `${result} (session: ${sessionId})`
}

/**
 * Escape a string for a double-quoted AppleScript literal. AppleScript has no
 * multi-line string literals — a raw control character breaks the script — so
 * backslash, quote, and the control characters AppleScript itself escapes
 * (`\r`, `\n`, `\t`) are replaced with their escape sequences.
 */
function escapeAppleScript(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
}

/** Escape a string for a single-quoted PowerShell literal. */
function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * Build the candidate notification commands for a platform, most preferred
 * first. macOS uses osascript; Linux prefers notify-send and falls back to
 * kdialog; Windows uses a PowerShell WScript.Shell popup.
 * @param platform - `process.platform` value.
 * @param title - the notification title, already final.
 * @param body - the notification body, already final.
 * @returns the ordered candidate commands.
 * @throws on unsupported platforms (callers should gate with
 * {@link isSupportedPlatform} first).
 */
export function buildCommands(platform: NodeJS.Platform, title: string, body: string): NotifyCommand[] {
  switch (platform) {
    case 'darwin':
      return [{
        command: 'osascript',
        args: ['-e', `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}" sound name "Glass"`],
      }]
    case 'linux':
      return [
        { command: 'notify-send', args: [title, body] },
        { command: 'kdialog', args: ['--passivepopup', body, title, '5'] },
      ]
    case 'win32':
      return [{
        command: 'powershell',
        args: ['-NoProfile', '-Command', `[System.Media.SystemSounds]::Asterisk.Play(); $ws = New-Object -ComObject WScript.Shell; $ws.Popup('${escapePowerShell(body)}', 5, '${escapePowerShell(title)}', 64)`],
      }]
    default:
      throw new Error(`dsh-notify-on-complete: unsupported platform "${platform}"`)
  }
}

/**
 * Candidate sound commands for a platform, most preferred first. macOS and
 * Windows already embed the sound in the notification command itself
 * (osascript `sound name` / .NET SystemSounds), so only Linux needs a
 * standalone chain: canberra-gtk-play (plays the themed completion chime)
 * falls back to paplay with the freedesktop sound theme's audio file.
 * @param platform - `process.platform` value.
 * @returns the ordered candidate sound commands; empty on platforms whose
 * notification command already plays the sound.
 */
export function buildSoundCommands(platform: NodeJS.Platform): NotifyCommand[] {
  switch (platform) {
    case 'linux':
      return [
        { command: 'canberra-gtk-play', args: ['-i', 'complete'] },
        { command: 'paplay', args: ['/usr/share/sounds/freedesktop/stereo/complete.oga'] },
      ]
    default:
      return []
  }
}

/**
 * Fire-and-forget a notification: spawn the first candidate detached and
 * unref'd; on ENOENT retry the next candidate (notify-send → kdialog). Any
 * other failure is swallowed — a missing notifier must never break the run it
 * reports on.
 * @param commands - ordered candidate commands from {@link buildCommands}.
 * @returns the spawned child, or undefined when no candidate remains.
 */
export function spawnNotify(commands: NotifyCommand[]): ReturnType<typeof spawn> | undefined {
  const [first, ...rest] = commands
  if (!first) return undefined
  const child = spawn(first.command, first.args, { detached: true, stdio: 'ignore' })
  child.once('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' && rest.length > 0) spawnNotify(rest)
  })
  child.unref()
  return child
}
