# 设置面板 + 差异化声音 + 勿扰时段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 插件配置进入 dsh Web 设置面板（官方 settings 机制自动渲染，无需 client 半）；完成/失败/审批用不同系统音色且面板可逐事件更换；支持勿扰时段（时段内完全不通知）。

**Architecture:** 纯 host 插件保持。新增 `src/quiet-hours.ts`（勿扰时段纯函数）、`src/settings.ts`（schemastery schema + `installSettingsSection` 接线，官方 `@deepseek-ai/dsh-settings` 机制，Web 设置界面自动渲染表单）；`src/notify.ts` 的 `buildCommands`/`buildSoundCommands` 增加音色参数并按事件 kind 差异化；`src/index.ts` 运行时通过 `current`（设置面板 > config > 默认）读取配置，通知入口检查勿扰时段。

**Tech Stack:** TypeScript (strict, ESM, NodeNext)、vitest、@deepseek-ai/dsh-settings、@deepseek-ai/schemastery

## Global Constraints

- 所有代码文件保持版权头（Copyright (c) 2026 Luozy / SPDX-License-Identifier: MIT）。
- 不新增运行时依赖（peerDependencies 的 `@deepseek-ai/dsh-settings`、`@deepseek-ai/schemastery` 由 dsh CLI 提供）。
- 现有 82 个测试必须保持通过（`buildCommands` 默认参数保证既有调用字符串不变）。
- 取值优先级：设置面板用户层 > `cordis.patch.yml` config > schema 默认值。
- 勿扰时段命中时跳过整个通知流程（不弹不响）。
- 音色归并三档：`completed` / `error` / `approval`（`turn/end` 的 `completed`→completed；`error`/`aborted`/`max-tokens`/`unknown`→error；blocked 事件（question/approval）→approval）。
- 音色标识：macOS 系统音色名（Glass/Sosumi/Ping/Funk/Basso/Pop/Heroine/Blow/Bottle/Frog）+ `'default'`（平台默认音）。

---

### Task 1: 勿扰时段纯函数

**Files:**
- Create: `src/quiet-hours.ts`
- Create: `tests/quiet-hours.spec.ts`

**Interfaces:**
- Produces:
  - `parseQuietRange(spec: string): [number, number] | null` —— `"HH:MM-HH:MM"` 解析为 `[startMin, endMin]`（分钟数，支持跨天 `23:00-08:00` → `[1380, 480]`）；非法输入（格式错、小时 >23、分钟 >59、空串）返回 `null`。
  - `isInQuietHours(now: Date, ranges: string[]): boolean` —— 任一 range 命中返回 `true`；`ranges` 为空返回 `false`；非法 range 忽略。开始时刻含（`>=`）、结束时刻不含（`<`）；跨天 range（start > end）表示 `[start, 24*60) ∪ [0, end)`。

- [ ] **Step 1: 写失败测试**

`tests/quiet-hours.spec.ts`：

```ts
/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from 'vitest'
import { isInQuietHours, parseQuietRange } from '../src/quiet-hours.js'

describe('parseQuietRange', () => {
  it('parses a same-day range into minutes', () => {
    expect(parseQuietRange('09:00-17:30')).toEqual([540, 1050])
  })

  it('parses a cross-midnight range (start after end)', () => {
    expect(parseQuietRange('23:00-08:00')).toEqual([1380, 480])
  })

  it('rejects malformed specs', () => {
    expect(parseQuietRange('')).toBeNull()
    expect(parseQuietRange('abc')).toBeNull()
    expect(parseQuietRange('25:00-08:00')).toBeNull()
    expect(parseQuietRange('23:60-08:00')).toBeNull()
    expect(parseQuietRange('23:00')).toBeNull()
    expect(parseQuietRange('23:00-08')).toBeNull()
  })
})

describe('isInQuietHours', () => {
  const at = (h: number, m = 0): Date => new Date(2026, 0, 1, h, m)

  it('is false with no ranges', () => {
    expect(isInQuietHours(at(10), [])).toBe(false)
  })

  it('matches inside a same-day range', () => {
    expect(isInQuietHours(at(10, 30), ['09:00-17:00'])).toBe(true)
  })

  it('does not match outside a same-day range', () => {
    expect(isInQuietHours(at(8, 59), ['09:00-17:00'])).toBe(false)
    expect(isInQuietHours(at(17, 0), ['09:00-17:00'])).toBe(false)
  })

  it('includes the start minute and excludes the end minute', () => {
    expect(isInQuietHours(at(9, 0), ['09:00-17:00'])).toBe(true)
    expect(isInQuietHours(at(17, 0), ['09:00-17:00'])).toBe(false)
  })

  it('matches across midnight', () => {
    expect(isInQuietHours(at(23, 30), ['23:00-08:00'])).toBe(true)
    expect(isInQuietHours(at(3, 0), ['23:00-08:00'])).toBe(true)
    expect(isInQuietHours(at(8, 0), ['23:00-08:00'])).toBe(false)
    expect(isInQuietHours(at(12, 0), ['23:00-08:00'])).toBe(false)
  })

  it('matches when any of several ranges hit', () => {
    expect(isInQuietHours(at(12, 30), ['23:00-08:00', '12:00-13:00'])).toBe(true)
    expect(isInQuietHours(at(10, 0), ['23:00-08:00', '12:00-13:00'])).toBe(false)
  })

  it('ignores malformed ranges', () => {
    expect(isInQuietHours(at(10, 0), ['garbage'])).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/quiet-hours.spec.ts`
Expected: FAIL（`Cannot find module '../src/quiet-hours.js'`）

- [ ] **Step 3: 实现 `src/quiet-hours.ts`**

```ts
/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
/** Quiet-hours helpers: parse "HH:MM-HH:MM" specs and test a moment against them. */

/** Parse `"HH:MM"` into minutes since midnight, or null when malformed. */
function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (match === null) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * Parse a quiet-hours spec `"HH:MM-HH:MM"` (24h; start after end crosses
 * midnight) into `[startMin, endMin]`. Returns null on malformed input.
 * @param spec - the spec string, e.g. `"23:00-08:00"`.
 * @returns the range in minutes, or null.
 */
export function parseQuietRange(spec: string): [number, number] | null {
  const [startSpec, endSpec, ...extra] = spec.split('-')
  if (extra.length > 0) return null
  const start = startSpec === undefined ? null : parseClock(startSpec)
  const end = endSpec === undefined ? null : parseClock(endSpec)
  if (start === null || end === null) return null
  return [start, end]
}

/** Whether `minute` falls in `[start, end)`, handling cross-midnight ranges. */
function inRange(minute: number, start: number, end: number): boolean {
  if (start <= end) return minute >= start && minute < end
  return minute >= start || minute < end
}

/**
 * Whether `now` falls inside any quiet-hours range. Malformed specs are
 * ignored; an empty list is never quiet. The start minute is included, the
 * end minute excluded.
 * @param now - the moment to test.
 * @param ranges - `"HH:MM-HH:MM"` specs; start after end crosses midnight.
 * @returns whether notifications should be suppressed.
 */
export function isInQuietHours(now: Date, ranges: string[]): boolean {
  const minute = now.getHours() * 60 + now.getMinutes()
  return ranges.some((spec) => {
    const range = parseQuietRange(spec)
    return range !== null && inRange(minute, range[0], range[1])
  })
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/quiet-hours.spec.ts`
Expected: 9/9 PASS

- [ ] **Step 5: 提交**

```bash
git add src/quiet-hours.ts tests/quiet-hours.spec.ts
git commit -m "feat: add quiet-hours helpers (parse + membership)"
```

---

### Task 2: 差异化声音（notify.ts 命令构建）

**Files:**
- Modify: `src/notify.ts`（`soundKeyFor`、`resolveSoundName`、`buildCommands` 第 4 参、`buildSoundCommands` 第 2 参）
- Modify: `tests/notify.spec.ts`

**Interfaces:**
- Consumes: 无（纯 notify.ts 内部演进）。
- Produces:
  - `export type SoundKey = 'completed' | 'error' | 'approval'`
  - `export const DEFAULT_SOUNDS: Record<SoundKey, string>` —— `{ completed: 'Glass', error: 'Sosumi', approval: 'Ping' }`
  - `export function soundKeyFor(kind: string): SoundKey` —— `completed`→completed；`error`/`aborted`/`max-tokens`/`unknown`/其他→error；`question`/`approval`→approval。
  - `export function resolveSoundName(sounds: Partial<Record<SoundKey, string>> | undefined, key: SoundKey): string` —— `sounds?.[key] ?? DEFAULT_SOUNDS[key]`。
  - `buildCommands(platform, title, body, soundName: string = 'Glass')` —— 第 4 参默认 `'Glass'`（既有调用不变）；macOS：`soundName === 'default'` 时不输出 `sound name` 参数，否则 ` sound name "<escaped>"`；Windows：映射表 `{ Glass→Asterisk, Sosumi→Exclamation, Ping→Question, default→Asterisk }`，其他音色名兜底 `Asterisk`。
  - `buildSoundCommands(platform, soundName: string = 'Glass')` —— Linux：canberra 事件 id 映射 `{ Glass→complete, Sosumi→error, Ping→info, default→complete }`（其他兜底 complete），paplay 文件映射同表（`complete.oga` / `error.oga` / `info.oga`）；darwin/win32 仍返回 `[]`。

- [ ] **Step 1: 写失败测试（追加到 `tests/notify.spec.ts`）**

在 `buildSoundCommands` describe 块之后追加：

```ts
describe('soundKeyFor', () => {
  it('groups turn-end kinds into the three sound tiers', () => {
    expect(soundKeyFor('completed')).toBe('completed')
    expect(soundKeyFor('error')).toBe('error')
    expect(soundKeyFor('aborted')).toBe('error')
    expect(soundKeyFor('max-tokens')).toBe('error')
    expect(soundKeyFor('unknown')).toBe('error')
    expect(soundKeyFor('question')).toBe('approval')
    expect(soundKeyFor('approval')).toBe('approval')
  })
})

describe('resolveSoundName', () => {
  it('falls back to the per-kind default', () => {
    expect(resolveSoundName(undefined, 'completed')).toBe('Glass')
    expect(resolveSoundName({}, 'error')).toBe('Sosumi')
  })

  it('prefers an explicit override', () => {
    expect(resolveSoundName({ completed: 'Funk' }, 'completed')).toBe('Funk')
  })
})

describe('buildCommands with differentiated sound', () => {
  it('embeds a custom sound name on macOS', () => {
    const [cmd] = buildCommands('darwin', 'T', 'B', 'Sosumi')
    expect(cmd.args[1]).toBe('display notification "B" with title "T" sound name "Sosumi"')
  })

  it('omits the sound name for the platform default on macOS', () => {
    const [cmd] = buildCommands('darwin', 'T', 'B', 'default')
    expect(cmd.args[1]).toBe('display notification "B" with title "T"')
  })

  it('keeps Glass as the default when no sound name is given', () => {
    const [cmd] = buildCommands('darwin', 'T', 'B')
    expect(cmd.args[1]).toBe('display notification "B" with title "T" sound name "Glass"')
  })

  it('maps macOS sound names to Windows SystemSounds', () => {
    const [cmd] = buildCommands('win32', 'T', 'B', 'Sosumi')
    expect(cmd.args.join(' ')).toContain('[System.Media.SystemSounds]::Exclamation.Play()')
  })

  it('maps unknown sound names to the Windows Asterisk fallback', () => {
    const [cmd] = buildCommands('win32', 'T', 'B', 'Frog')
    expect(cmd.args.join(' ')).toContain('[System.Media.SystemSounds]::Asterisk.Play()')
  })
})

describe('buildSoundCommands with differentiated sound', () => {
  it('maps a custom sound to the linux canberra event and paplay file', () => {
    expect(buildSoundCommands('linux', 'Sosumi')).toEqual([
      { command: 'canberra-gtk-play', args: ['-i', 'error'] },
      { command: 'paplay', args: ['/usr/share/sounds/freedesktop/stereo/error.oga'] },
    ])
  })

  it('maps the platform default to the linux completion chime', () => {
    expect(buildSoundCommands('linux', 'default')).toEqual([
      { command: 'canberra-gtk-play', args: ['-i', 'complete'] },
      { command: 'paplay', args: ['/usr/share/sounds/freedesktop/stereo/complete.oga'] },
    ])
  })
})
```

更新文件顶部 import：

```ts
import { buildBody, buildCommands, buildSoundCommands, isSupportedPlatform, resolveSoundName, resultText, soundKeyFor, spawnNotify } from '../src/notify.js'
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/notify.spec.ts`
Expected: 新增用例 FAIL（`soundKeyFor is not a function` / 字符串不匹配）

- [ ] **Step 3: 实现 `src/notify.ts`**

在 `resultText` 之后新增：

```ts
/** The three sound tiers: completion, failure, and blocking interactions. */
export type SoundKey = 'completed' | 'error' | 'approval'

/** Default per-tier sound names (macOS system sound names). */
export const DEFAULT_SOUNDS: Record<SoundKey, string> = {
  completed: 'Glass',
  error: 'Sosumi',
  approval: 'Ping',
}

/**
 * Group an event kind into its sound tier: turn endings map completed to the
 * completion chime and everything else to the failure chime; blocking
 * interactions (question / approval) share the attention chime.
 * @param kind - the event kind (`turn/end` reason or blocked kind).
 * @returns the sound tier key.
 */
export function soundKeyFor(kind: string): SoundKey {
  switch (kind) {
    case 'completed': return 'completed'
    case 'question':
    case 'approval': return 'approval'
    default: return 'error'
  }
}

/**
 * Resolve the sound name for a tier: the configured override, or the
 * per-tier default.
 * @param sounds - per-tier overrides from config/settings.
 * @param key - the sound tier.
 * @returns the macOS sound name to use, or `'default'` for the platform default.
 */
export function resolveSoundName(sounds: Partial<Record<SoundKey, string>> | undefined, key: SoundKey): string {
  return sounds?.[key] ?? DEFAULT_SOUNDS[key]
}
```

`buildCommands` 签名与 macOS / Windows 分支改为：

```ts
/**
 * Build the candidate notification commands for a platform, most preferred
 * first. macOS uses osascript; Linux prefers notify-send and falls back to
 * kdialog; Windows uses a PowerShell WScript.Shell popup. macOS embeds the
 * sound name; Windows maps it to a .NET SystemSounds member.
 * @param platform - `process.platform` value.
 * @param title - the notification title, already final.
 * @param body - the notification body, already final.
 * @param soundName - macOS sound name, or `'default'` for the platform default.
 * @returns the ordered candidate commands.
 * @throws on unsupported platforms (callers should gate with
 * {@link isSupportedPlatform} first).
 */
export function buildCommands(platform: NodeJS.Platform, title: string, body: string, soundName = 'Glass'): NotifyCommand[] {
  switch (platform) {
    case 'darwin':
      return [{
        command: 'osascript',
        args: ['-e', `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"${soundName === 'default' ? '' : ` sound name "${escapeAppleScript(soundName)}"`}`],
      }]
    case 'linux':
      return [
        { command: 'notify-send', args: [title, body] },
        { command: 'kdialog', args: ['--passivepopup', body, title, '5'] },
      ]
    case 'win32': {
      const windowsSound = { Glass: 'Asterisk', Sosumi: 'Exclamation', Ping: 'Question' }[soundName] ?? 'Asterisk'
      return [{
        command: 'powershell',
        args: ['-NoProfile', '-Command', `[System.Media.SystemSounds]::${windowsSound}.Play(); $ws = New-Object -ComObject WScript.Shell; $ws.Popup('${escapePowerShell(body)}', 5, '${escapePowerShell(title)}', 64)`],
      }]
    }
    default:
      throw new Error(`dsh-notify-on-complete: unsupported platform "${platform}"`)
  }
}
```

`buildSoundCommands` 改为：

```ts
/** Linux mapping: macOS sound name → canberra event id + freedesktop theme file. */
const LINUX_SOUNDS: Record<string, { event: string; file: string }> = {
  Glass: { event: 'complete', file: 'complete.oga' },
  Sosumi: { event: 'error', file: 'error.oga' },
  Ping: { event: 'info', file: 'info.oga' },
  default: { event: 'complete', file: 'complete.oga' },
}

/**
 * Candidate sound commands for a platform, most preferred first. macOS and
 * Windows already embed the sound in the notification command itself, so only
 * Linux needs a standalone chain: canberra-gtk-play (plays the themed event)
 * falls back to paplay with the freedesktop sound theme's audio file.
 * @param platform - `process.platform` value.
 * @param soundName - the resolved macOS sound name, or `'default'`.
 * @returns the ordered candidate sound commands; empty on platforms whose
 * notification command already plays the sound.
 */
export function buildSoundCommands(platform: NodeJS.Platform, soundName = 'Glass'): NotifyCommand[] {
  switch (platform) {
    case 'linux': {
      const sound = LINUX_SOUNDS[soundName] ?? LINUX_SOUNDS['default']!
      return [
        { command: 'canberra-gtk-play', args: ['-i', sound.event] },
        { command: 'paplay', args: [`/usr/share/sounds/freedesktop/stereo/${sound.file}`] },
      ]
    }
    default:
      return []
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/notify.spec.ts`
Expected: 全部 PASS（新增 11 个用例）；现有用例不变

- [ ] **Step 5: 提交**

```bash
git add src/notify.ts tests/notify.spec.ts
git commit -m "feat: differentiate sound by event kind with per-platform mappings"
```

---

### Task 3: 设置 schema + index.ts 接线

**Files:**
- Modify: `src/types.ts`（`NotifyConfig` 扩展 `sounds` / `quietHours`）
- Create: `src/settings.ts`（namespace + schemastery schema + `installSettingsSection` 接线）
- Modify: `src/index.ts`（`current` 运行时配置 + 勿扰时段入口检查 + 开关动态化）
- Create: `tests/settings.spec.ts`
- Modify: `tests/index.spec.ts`
- Modify: `package.json`（依赖 + files）

**Interfaces:**
- Consumes: Task 1 `isInQuietHours`；Task 2 `soundKeyFor`、`resolveSoundName`、`DEFAULT_SOUNDS`、`SoundKey`。
- Produces:
  - `NotifyConfig` 新增：`sounds?: Partial<Record<SoundKey, string>>`、`quietHours?: string[]`。
  - `src/settings.ts`：`export const NOTIFY_SETTINGS_NAMESPACE`、`export const NotifySettingsSchema`（schemastery schema，类型 `NotifyConfig`）。
  - `apply` 内 `let current: NotifyConfig = config` + `installSettingsSection(ctx, NOTIFY_SETTINGS_NAMESPACE, NotifySettingsSchema, config, { setSource: (get) => { current = get() }, onChange: () => {} })`；两个 notify 回调入口检查 `isInQuietHours(new Date(), current.quietHours ?? [])` 与 `current.enabled`；blocked 开关改为回调内检查 `current.onBlocked/onQuestion/onApproval`；声音参数用 `resolveSoundName(current.sounds, soundKeyFor(kind))` 传入 `buildCommands`/`buildSoundCommands`。

- [ ] **Step 1: 安装依赖**

Run: `pnpm add -D @deepseek-ai/dsh-settings@^0.1.0-rc.5 @deepseek-ai/schemastery`
Run: `pnpm add -P @deepseek-ai/dsh-settings@^0.1.0-rc.5 @deepseek-ai/schemastery`
Expected: 两个包进入 peerDependencies 与 devDependencies；`files` 数组保持 `["lib", "cordis.patch.yml"]` 不变（源码文件不打包，仅 lib）。

> 若 `@deepseek-ai/schemastery` 版本无法解析，用 `pnpm add -D @deepseek-ai/schemastery@latest` 并让版本与 `@deepseek-ai/dsh-settings` 的 peer 要求一致（它内部声明 `@deepseek-ai/schemastery` peer）。

- [ ] **Step 2: 扩展 `src/types.ts`**

`NotifyConfig` 接口改为（import 型 `SoundKey` 来自 `./notify.js`——为保持 types.ts 零依赖，把 `SoundKey` 内联为字面量联合）：

```ts
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
```

- [ ] **Step 3: 创建 `src/settings.ts`**

```ts
/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { Schema } from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { NotifyConfig } from './types.js'

/** Settings namespace for this plugin; the web settings panel renders its schema. */
export const NOTIFY_SETTINGS_NAMESPACE = settingsNamespace('notify-on-complete')

/** Declarative settings schema — the web settings panel renders a form from it. */
export const NotifySettingsSchema = Schema.object({
  enabled: Schema.boolean().default(true),
  title: Schema.string().default('DeepSeek Harness'),
  sound: Schema.boolean().default(true),
  sounds: Schema.object({
    completed: Schema.string().default('Glass'),
    error: Schema.string().default('Sosumi'),
    approval: Schema.string().default('Ping'),
  }),
  quietHours: Schema.array(Schema.string()).default([]),
  onBlocked: Schema.boolean().default(true),
  onQuestion: Schema.boolean().default(true),
  onApproval: Schema.boolean().default(true),
})

/**
 * Wire this plugin's settings namespace into the harness: while a settings
 * service exists, the web panel edits take precedence over the composition
 * entry config; without one, the entry config stands.
 * @param ctx - the plugin context.
 * @param config - the composition entry config (cordis.patch.yml layer).
 * @param setCurrent - sink for the authoritative value; called on attach,
 * detach, and every committed change.
 */
export function installNotifySettings(ctx: Context, config: NotifyConfig, setCurrent: (value: NotifyConfig) => void): void {
  installSettingsSection(ctx, NOTIFY_SETTINGS_NAMESPACE, NotifySettingsSchema, config, {
    setSource: (current) => { setCurrent(current()) },
    onChange: () => {},
  })
}
```

- [ ] **Step 4: 改 `src/index.ts`**

import 区改为：

```ts
import { blockedBody, buildBody, buildCommands, buildSoundCommands, isSupportedPlatform, resolveSoundName, resultText, soundKeyFor, spawnNotify } from './notify.js'
import { isInQuietHours } from './quiet-hours.js'
import { BlockedNotifier, RunEndNotifier } from './notifier.js'
import { installNotifySettings } from './settings.js'
import type { AgentStatusPayload, NotifyConfig, Session, SessionEvent } from './types.js'
```

`apply` 内：删除 `const title = ...`、`const sound = ...`、`const onBlocked/onQuestion/onApproval` 的取值（保留 enabled 校验与 fail-loud 校验），改为：

```ts
export function apply(ctx: Context, config: NotifyConfig = {}): void {
  // Entry-config validation stays fail-loud for profiles without a settings
  // service; the settings panel validates its own writes via the schema.
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
    throw new Error(`dsh-notify-on-complete: config.enabled must be a boolean, got ${typeof config.enabled}`)
  }
  if (config.title !== undefined && typeof config.title !== 'string') {
    throw new Error(`dsh-notify-on-complete: config.title must be a string, got ${typeof config.title}`)
  }
  if (config.sound !== undefined && typeof config.sound !== 'boolean') {
    throw new Error(`dsh-notify-on-complete: config.sound must be a boolean, got ${typeof config.sound}`)
  }
  for (const key of ['onBlocked', 'onQuestion', 'onApproval'] as const) {
    if (config[key] !== undefined && typeof config[key] !== 'boolean') {
      throw new Error(`dsh-notify-on-complete: config.${key} must be a boolean, got ${typeof config[key]}`)
    }
  }
  if (config.quietHours !== undefined && !Array.isArray(config.quietHours)) {
    throw new Error(`dsh-notify-on-complete: config.quietHours must be an array of strings, got ${typeof config.quietHours}`)
  }

  // The authoritative value: settings panel user layer > entry config > defaults.
  let current: NotifyConfig = config
  installNotifySettings(ctx, config, (value) => { current = value })

  if (!(current.enabled ?? true)) return

  if (!isSupportedPlatform(process.platform)) {
    ctx.logger?.warn?.(`dsh-notify-on-complete: unsupported platform "${process.platform}" — notifications disabled`)
    return
  }

  /** Suppressed during quiet hours and when disabled. */
  const active = (): boolean => (current.enabled ?? true) && !isInQuietHours(new Date(), current.quietHours ?? [])

  const notifier = new RunEndNotifier({
    notify: (kind: string, sessionId: string, sessionTitle: string): void => {
      if (!active()) return
      const soundName = resolveSoundName(current.sounds, soundKeyFor(kind))
      spawnNotify(buildCommands(process.platform, current.title ?? 'DeepSeek Harness', buildBody(resultText(kind), sessionId, sessionTitle), soundName))
      if (current.sound ?? true) spawnNotify(buildSoundCommands(process.platform, soundName))
    },
  })

  const blockedNotifier = new BlockedNotifier({
    notify: (kind: string, detail: string, sessionId: string, sessionTitle: string): void => {
      if (!(current.onBlocked ?? true)) return
      if (kind === 'question' && !(current.onQuestion ?? true)) return
      if (kind === 'approval' && !(current.onApproval ?? true)) return
      if (!active()) return
      const soundName = resolveSoundName(current.sounds, soundKeyFor(kind))
      spawnNotify(buildCommands(process.platform, current.title ?? 'DeepSeek Harness', blockedBody(kind, detail, sessionId, sessionTitle), soundName))
      if (current.sound ?? true) spawnNotify(buildSoundCommands(process.platform, soundName))
    },
    onQuestion: true,
    onApproval: true,
  })
  // ...注册监听器部分保持不变
}
```

（`BlockedNotifier` 构造参数 `onQuestion: true, onApproval: true` —— 实际开关在回调内按 `current` 动态判断。）

- [ ] **Step 5: 写测试**

`tests/settings.spec.ts`：

```ts
/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from 'vitest'
import { NotifySettingsSchema } from '../src/settings.js'

describe('NotifySettingsSchema', () => {
  it('resolves defaults for an empty document', () => {
    expect(NotifySettingsSchema({})).toEqual({
      enabled: true,
      title: 'DeepSeek Harness',
      sound: true,
      sounds: { completed: 'Glass', error: 'Sosumi', approval: 'Ping' },
      quietHours: [],
      onBlocked: true,
      onQuestion: true,
      onApproval: true,
    })
  })

  it('overlays user fields over the defaults', () => {
    expect(NotifySettingsSchema({ sound: false, quietHours: ['23:00-08:00'] })).toMatchObject({
      sound: false,
      quietHours: ['23:00-08:00'],
      title: 'DeepSeek Harness',
    })
  })

  it('rejects a non-boolean sound', () => {
    expect(() => NotifySettingsSchema({ sound: 1 as never })).toThrow()
  })
})
```

`tests/index.spec.ts` 追加三个用例（现有用例不动 —— `buildCommands` 默认参数保持既有字符串、darwin 声音数组为空）：

```ts
  it('does not notify during quiet hours', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx, { quietHours: ['00:00-23:59'] })
    ctx.emit('session/event', ...rootTurnEnd('completed'))
    ctx.emit('agent/status', ...idleRoot())
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  it('notifies outside quiet hours', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    // 23:00-08:00 covers midnight; a 10:00 event is outside it.
    apply(ctx, { quietHours: ['23:00-08:00'] })
    ctx.emit('session/event', ...rootTurnEnd('completed'))
    ctx.emit('agent/status', ...idleRoot())
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
  })

  it('uses the per-kind sound name for failures', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx, { sounds: { error: 'Sosumi' } })
    ctx.emit('session/event', ...rootTurnEnd('error'))
    ctx.emit('agent/status', ...idleRoot())
    expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).toContain('sound name "Sosumi"')
  })
```

- [ ] **Step 6: 运行测试确认**

Run: `pnpm test`
Expected: 全部 PASS（现有 82 + quiet-hours 10 + notify 新增 11 + settings 3 + index 新增 3 = 109）

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat: wire settings panel via dsh-settings schema, quiet hours, dynamic switches"
```

---

### Task 4: README 文档

**Files:**
- Modify: `README.md`
- Modify: `README.zh.md`

- [ ] **Step 1: 英文 README 更新**

在 `## 配置` 部分之前新增 `## 设置面板（Web GUI）` 小节：

```markdown
## Settings Panel (Web GUI)

Open **dsh web → Settings → 插件** (or the plugin card's settings entry) and find the **notify-on-complete** section. The panel renders from the plugin's declared schema, so every option below is editable in the UI — no `cordis.patch.yml` edits needed:

- **enabled / title / sound / onBlocked / onQuestion / onApproval** — the same switches as the config file.
- **sounds** — per-tier sound names (macOS sound names like Glass / Sosumi / Ping / Funk, or `default`): completion, failure, and attention (question/approval) chimes.
- **quietHours** — `"HH:MM-HH:MM"` ranges (start after end crosses midnight); inside a range the plugin is fully silent (no banner, no chime). Example: `["23:00-08:00"]`.

Values take precedence over the profile's `cordis.patch.yml` config; fields you never touch fall back to the config file, then to defaults. Profiles without a settings service (e.g. CLI one-shot) simply use the config file as before.
```

在配置表追加两行：

```markdown
| `sounds` | object | `{completed: "Glass", error: "Sosumi", approval: "Ping"}` | 每档事件的音色（macOS 音色名或 `default`） |
| `quietHours` | string[] | `[]` | 勿扰时段 `"HH:MM-HH:MM"`（开始晚于结束表示跨天）；时段内完全不通知 |
```

- [ ] **Step 2: 中文 README 更新**

对应位置新增 `## 设置面板（Web GUI）`（内容同上，中文）：

```markdown
## 设置面板（Web GUI）

打开 **dsh web → 设置 → 插件**，找到 **notify-on-complete** 分区即可可视化配置——面板由插件声明的 schema 自动渲染，**无需手动编辑 `cordis.patch.yml`**：

- **enabled / title / sound / onBlocked / onQuestion / onApproval** —— 与配置文件相同的开关。
- **sounds** —— 每档事件音色（macOS 音色名如 Glass / Sosumi / Ping / Funk，或 `default`）：完成、失败、提问/审批三档可分别更换。
- **quietHours** —— 勿扰时段 `"HH:MM-HH:MM"`（开始晚于结束表示跨天）；时段内完全不弹通知也不响铃。示例：`["23:00-08:00"]`。

面板值优先于 profile 的 `cordis.patch.yml`；没动过的字段回退到配置文件，再到默认值。无设置服务的场景（如 CLI 一次性运行）按配置文件工作，行为不变。
```

配置表追加同样两行（中文）。

- [ ] **Step 3: 验证**

Run: `grep -n "quietHours\|设置面板\|Settings Panel" README.md README.zh.md`
Expected: 每个文件至少 3 处命中

- [ ] **Step 4: 提交**

```bash
git add README.md README.zh.md
git commit -m "docs: document settings panel, differentiated sounds, and quiet hours"
```

---

## 收尾

- [ ] 全量验证：`pnpm run typecheck && pnpm test`（预期 109 用例全绿）
- [ ] `pnpm run build`（产物含新文件，add-header 补版权头）
- [ ] `git push origin main`