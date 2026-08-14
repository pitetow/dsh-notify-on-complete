# dsh-notify-on-complete Implementation Plan

> Copyright (c) 2026 Luozy · SPDX-License-Identifier: MIT

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone, zero-runtime-dependency Cordis plugin that fires an OS desktop notification whenever a dsh CLI run ends, distinguishing success/error/abort.

**Architecture:** The plugin registers a global `session/event` listener, filters `turn/end` events on root sessions (no `parentSession`), maps `reason.kind` to a Chinese result string, and spawns a detached fire-and-forget OS notification command chosen by `process.platform` (osascript / notify-send→kdialog / PowerShell popup). No `ctx.shell` dependency; `child_process.spawn` with `detached: true` + `unref()` so teardown never blocks or is blocked.

**Tech Stack:** TypeScript (strict, ESM, NodeNext), Node ^22, vitest, peer `@deepseek-ai/cordis` (^4.0.1, published on npm).

**Spec:** `docs/design.md` (approved 2026-08-14).

---

### Task 1: Scaffold the standalone project

**Files:**
- Create: `./package.json`
- Create: `./tsconfig.json`
- Create: `./vitest.config.ts`
- Create: `./.gitignore`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "dsh-notify-on-complete",
  "version": "0.1.0",
  "description": "DeepSeek Harness plugin: desktop notification when a run ends",
  "type": "module",
  "license": "MIT",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "import": "./lib/index.js"
    }
  },
  "files": ["lib"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@types/node": "^22",
    "typescript": "^5",
    "vitest": "^3"
  }
}
```

- [ ] **Step 2: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noImplicitAny": true,
    "declaration": true,
    "declarationDir": "lib/types",
    "outDir": "lib",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Source imports use `.js` extensions (NodeNext output); tests resolve them to `.ts`.
    extensionAlias: { '.js': ['.ts', '.js'] },
  },
})
```

- [ ] **Step 4: Write .gitignore**

```
node_modules/
lib/
coverage/
```

- [ ] **Step 5: Install dependencies**

Run: `cd . && pnpm install`
Expected: lockfile created, `@deepseek-ai/cordis@4.0.1` + vitest + typescript resolved.

- [ ] **Step 6: Commit**

```bash
cd .
git add package.json tsconfig.json vitest.config.ts .gitignore pnpm-lock.yaml
git commit -m "chore: scaffold standalone dsh-notify-on-complete project"
```

---

### Task 2: Structural event types

**Files:**
- Create: `./src/types.ts`

- [ ] **Step 1: Write src/types.ts**

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `cd . && pnpm run typecheck`
Expected: PASS (empty output, exit 0).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add structural session event types"
```

---

### Task 3: Notification mapping, command building, and spawn

**Files:**
- Create: `./src/notify.ts`

- [ ] **Step 1: Write src/notify.ts**

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/notify.ts
git commit -m "feat: add result mapping, platform commands, and fire-and-forget spawn"
```

---

### Task 4: Unit tests for notify.ts

**Files:**
- Create: `./tests/notify.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
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

import { buildBody, buildCommands, resultText, spawnNotify } from '../src/notify.js'

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
      'display notification "任务已完成 (session: a)" with title "DeepSeek Harness"',
    ])
  })

  it('escapes backslashes and quotes for AppleScript', () => {
    const [cmd] = buildCommands('darwin', 'Title "x"', 'Body \\ y')
    expect(cmd.args[1]).toBe('display notification "Body \\\\ y" with title "Title \\"x\\""')
  })

  it('builds Linux notify-send with a kdialog fallback', () => {
    expect(buildCommands('linux', 'T', 'B')).toEqual([
      { command: 'notify-send', args: ['T', 'B'] },
      { command: 'kdialog', args: ['--passivepopup', 'B', 'T', '5'] },
    ])
  })

  it('builds the Windows PowerShell popup and escapes single quotes', () => {
    const [cmd] = buildCommands('win32', 'T', "B'x")
    expect(cmd.command).toBe('powershell')
    expect(cmd.args.join(' ')).toContain("$ws.Popup('B''x', 5, 'T', 64)")
  })

  it('throws on unsupported platforms', () => {
    expect(() => buildCommands('aix' as NodeJS.Platform, 'T', 'B')).toThrow(/unsupported platform/)
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
```

- [ ] **Step 2: Run tests to verify they fail (no src yet)**

Run: `pnpm run test`
Expected: FAIL — `Cannot find module '../src/notify.js'` (tests exist, implementation does not).

- [ ] **Step 3: Write src/notify.ts** (Task 3 content — repeat the file here so the engineer does not need Task 3 open).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test`
Expected: PASS — all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add tests/notify.spec.ts
git commit -m "test: cover result mapping, command building, and spawn fallback"
```

---

### Task 5: Plugin entry

**Files:**
- Create: `./src/index.ts`

- [ ] **Step 1: Check whether the harness session types are published**

Run: `npm view @deepseek-ai/dsh-session version`
- If a version prints: add `"@deepseek-ai/dsh-session": "^<version>"` to `devDependencies` in package.json, `pnpm install`, and use the side-effect type import below.
- If it errors (not published): skip the side-effect import and keep the cast registration.

- [ ] **Step 2: Write src/index.ts**

```ts
import type { Context } from '@deepseek-ai/cordis'
import { buildBody, buildCommands, resultText, spawnNotify } from './notify.js'
import type { NotifyConfig, Session, SessionEvent, TurnEndData } from './types.js'
// Pull in the harness's typed session/event declaration so ctx.on type-checks.
import type {} from '@deepseek-ai/dsh-session'

export const name = 'dsh-notify-on-complete'

/**
 * Notify the OS when a root-session run ends. Listens to `session/event`,
 * filters `turn/end` on root sessions (subagent sessions carry a
 * `parentSession` header), and fire-and-forgets a platform notification.
 * Config validation fails loud at load time; `enabled: false` registers nothing.
 * @param ctx - the plugin context.
 * @param config - optional `{ enabled?, title? }`.
 */
export function apply(ctx: Context, config: NotifyConfig = {}): void {
  const enabled = config.enabled ?? true
  const title = config.title ?? 'DeepSeek Harness'
  if (typeof enabled !== 'boolean') {
    throw new Error(`dsh-notify-on-complete: config.enabled must be a boolean, got ${typeof enabled}`)
  }
  if (typeof title !== 'string') {
    throw new Error(`dsh-notify-on-complete: config.title must be a string, got ${typeof title}`)
  }
  if (!enabled) return

  const onSessionEvent = (session: Session, event: SessionEvent): void => {
    if (event.type !== 'turn/end') return
    if (session.header.parentSession !== undefined) return
    const data = event.data as TurnEndData
    spawnNotify(buildCommands(process.platform, title, buildBody(resultText(data.reason.kind), session.header.id)))
  }
  ctx.on('session/event', onSessionEvent)
}
```

If Step 1 found no published `@deepseek-ai/dsh-session`, replace the registration with a cast so the unknown event name compiles:

```ts
  const register = ctx.on as unknown as (
    name: string,
    listener: (session: Session, event: SessionEvent) => void,
  ) => () => void
  register('session/event', onSessionEvent)
```

- [ ] **Step 3: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 4: Build**

Run: `pnpm run build`
Expected: `lib/index.js`, `lib/notify.js`, `lib/types/*.d.ts` emitted.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts package.json pnpm-lock.yaml
git commit -m "feat: add plugin entry listening on session/event turn/end"
```

---

### Task 6: README and example config

**Files:**
- Create: `./README.md`
- Create: `./example.cordis.yml`

- [ ] **Step 1: Write README.md**

```markdown
# dsh-notify-on-complete

DeepSeek Harness 插件：每次 dsh CLI 运行结束时向操作系统发送桌面通知，正文按结果区分（成功 / 失败 / 中止 / 达到 token 上限）。

## 安装

```bash
npm install dsh-notify-on-complete   # 或 pnpm add / yarn add
```

插件是零运行时依赖的 Cordis function plugin，peer 依赖 `@deepseek-ai/cordis@^4.0.1`（由 dsh CLI 提供）。

## 加载

在 dsh CLI 的 cordis.yml 中加入插件条目（确保你的 CLI 部署能从 node_modules 解析到该包名）：

```yaml
- id: notify-on-complete
  name: dsh-notify-on-complete
```

最小配置（均为默认值，可不写）：

```yaml
- id: notify-on-complete
  name: dsh-notify-on-complete
  config:
    enabled: true              # 默认 true
    title: DeepSeek Harness    # 通知标题
```

## 行为

- 监听全局 `session/event`，过滤 `turn/end` 且只看根会话（排除子代理会话），CLI 一次运行只通知一次。
- 结果映射：`completed` → 任务已完成；`error` → 任务失败；`aborted` → 任务已中止；`max-tokens` → 任务达到 token 上限；未知 → 任务结束。
- 通知正文：结果文本 + 会话 ID，例如 `任务已完成 (session: 3f9a…)`。
- 平台命令（按 `process.platform` 自动选择，fire-and-forget，不阻塞退出）：
  - macOS：`osascript` 原生通知
  - Linux：`notify-send`（缺失时回退 `kdialog --passivepopup`）
  - Windows：PowerShell `WScript.Shell.Popup` 弹窗

## 开发

```bash
pnpm install
pnpm run test        # vitest 单元测试
pnpm run typecheck   # tsc --noEmit
pnpm run build       # 产物到 lib/
```
```

- [ ] **Step 2: Write example.cordis.yml**

```yaml
# 可直接粘贴到 dsh CLI 的 cordis.yml 的 plugins 列表
- id: notify-on-complete
  name: dsh-notify-on-complete
  config:
    enabled: true
    title: DeepSeek Harness
```

- [ ] **Step 3: Commit**

```bash
git add README.md example.cordis.yml
git commit -m "docs: add README and example cordis.yml"
```

---

### Task 7: Final verification

- [ ] **Step 1: Full check**

Run: `pnpm run typecheck && pnpm run test && pnpm run build`
Expected: typecheck PASS, all tests PASS, `lib/` emitted.

- [ ] **Step 2: Inspect built output**

Run: `ls lib && node --input-type=module -e "import('./lib/index.js').then(m => console.log(m.name))"`
Expected: `lib/index.js lib/notify.js lib/types` and `dsh-notify-on-complete` printed.

- [ ] **Step 3: Commit any leftovers**

```bash
git add -A
git commit -m "chore: final verification" || true
```
