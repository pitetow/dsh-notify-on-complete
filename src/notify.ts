import { spawn } from 'node:child_process'

/** A notification command: executable + argv, spawned without a shell. */
export interface NotifyCommand {
  command: string
  args: string[]
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

/** Escape a string for a double-quoted AppleScript literal. */
function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
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
 * @throws on unsupported platforms.
 */
export function buildCommands(platform: NodeJS.Platform, title: string, body: string): NotifyCommand[] {
  switch (platform) {
    case 'darwin':
      return [{
        command: 'osascript',
        args: ['-e', `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"`],
      }]
    case 'linux':
      return [
        { command: 'notify-send', args: [title, body] },
        { command: 'kdialog', args: ['--passivepopup', body, title, '5'] },
      ]
    case 'win32':
      return [{
        command: 'powershell',
        args: ['-NoProfile', '-Command', `$ws = New-Object -ComObject WScript.Shell; $ws.Popup('${escapePowerShell(body)}', 5, '${escapePowerShell(title)}', 64)`],
      }]
    default:
      throw new Error(`dsh-notify-on-complete: unsupported platform "${platform}"`)
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
