# 通知提示音 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通知弹出时同时播放系统提示音（macOS Glass / Windows SystemSounds / Linux canberra→paplay 回退），可配置关闭。

**Architecture:** macOS/Windows 把声音内嵌进现有通知命令字符串（osascript `sound name` / PowerShell `.Play()`）；Linux 新增 `buildSoundCommands()` 独立声音候选链，`index.ts` 在通知 spawn 后并行 spawn，复用 `spawnNotify` 的 ENOENT 回退，失败静默。配置新增 `sound?: boolean`（默认 true），fail-loud 校验。

**Tech Stack:** TypeScript (strict, ESM, NodeNext)、vitest、node:child_process

## Global Constraints

- 所有代码文件保持版权头（Copyright (c) 2026 Luozy / SPDX-License-Identifier: MIT）。
- 不引入任何新依赖；不修改通知命令的 `notify-send → kdialog` 回退语义。
- 声音是附加体验：命令缺失按 ENOENT 回退，播放失败静默，绝不抛错、不影响通知。
- 现有测试断言（darwin 平台 spawn 次数）必须保持通过——darwin 下声音数组为空，不产生额外 spawn。

---

### Task 1: notify.ts 声音命令构建 + 测试

**Files:**
- Modify: `src/notify.ts`（macOS/Windows 命令字符串、新增 `buildSoundCommands`）
- Modify: `tests/notify.spec.ts`

**Interfaces:**
- Consumes: 现有 `NotifyCommand`、`buildCommands`、`escapeAppleScript`、`escapePowerShell`（保持签名不变）。
- Produces: `buildSoundCommands(platform: NodeJS.Platform): NotifyCommand[]` —— linux 返回 canberra→paplay 候选链，darwin/win32 返回 `[]`。

- [ ] **Step 1: 更新 macOS 断言（红）**

在 `tests/notify.spec.ts` 的 `builds the macOS osascript command` 用例中，把期望命令字符串改为包含 `sound name "Glass"`：

```ts
it('builds the macOS osascript command', () => {
    const [cmd] = buildCommands('darwin', 'DeepSeek Harness', '任务已完成 (session: a)')
    expect(cmd.command).toBe('osascript')
    expect(cmd.args).toEqual([
      '-e',
      'display notification "任务已完成 (session: a)" with title "DeepSeek Harness" sound name "Glass"',
    ])
  })
```

- [ ] **Step 2: 更新 Windows 断言（红）**

在 `builds the Windows PowerShell popup and escapes single quotes` 用例中追加 `.Play()` 断言：

```ts
it('builds the Windows PowerShell popup and escapes single quotes', () => {
    const [cmd] = buildCommands('win32', 'T', "B'x")
    expect(cmd.command).toBe('powershell')
    expect(cmd.args.join(' ')).toContain("$ws.Popup('B''x', 5, 'T', 64)")
    expect(cmd.args.join(' ')).toContain('[System.Media.SystemSounds]::Asterisk.Play()')
  })
```

- [ ] **Step 3: 新增 buildSoundCommands 测试（红）**

在 `tests/notify.spec.ts` 的 `isSupportedPlatform` describe 块之后新增：

```ts
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
  })
})
```

并把 `buildSoundCommands` 加入文件顶部的 import 列表：

```ts
import { buildBody, buildCommands, buildSoundCommands, isSupportedPlatform, resultText, spawnNotify } from '../src/notify.js'
```

- [ ] **Step 4: 运行测试确认失败（红）**

Run: `pnpm test`
Expected: 3 个失败（macOS 字符串不匹配、Windows 缺 `.Play()`、`buildSoundCommands is not a function`）

- [ ] **Step 5: 实现 src/notify.ts**

把 macOS 分支的 osascript 参数改为：

```ts
    case 'darwin':
      return [{
        command: 'osascript',
        args: ['-e', `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}" sound name "Glass"`],
      }]
```

Windows 分支改为（在 Popup 后追加 `.Play()`，分号连接）：

```ts
    case 'win32':
      return [{
        command: 'powershell',
        args: ['-NoProfile', '-Command', `$ws = New-Object -ComObject WScript.Shell; $ws.Popup('${escapePowerShell(body)}', 5, '${escapePowerShell(title)}', 64); [System.Media.SystemSounds]::Asterisk.Play()`],
      }]
```

在 `buildCommands` 函数之后新增：

```ts
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
```

- [ ] **Step 6: 运行测试确认通过（绿）**

Run: `pnpm test`
Expected: 全部通过（notify.spec 15→17 用例，总数 37）

- [ ] **Step 7: 提交**

```bash
git add src/notify.ts tests/notify.spec.ts
git commit -m "feat: embed system sound in macOS/Windows commands, add Linux sound chain"
```

---

### Task 2: sound 配置 + index.ts 接线 + 测试

**Files:**
- Modify: `src/types.ts`（NotifyConfig 加 `sound?`）
- Modify: `src/index.ts`（校验 + spawn 声音）
- Modify: `tests/index.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `buildSoundCommands(platform)`。
- Produces: `NotifyConfig.sound?: boolean`（默认 true）；`apply` 在通知 spawn 后追加 `spawnNotify(buildSoundCommands(process.platform))`（仅当 sound 为 true）。

- [ ] **Step 1: 写失败测试（红）**

在 `tests/index.spec.ts` 末尾（最后一个 `it` 之后、describe 闭合 `})` 之前）新增三个用例：

```ts
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
```

- [ ] **Step 2: 运行测试确认失败（红）**

Run: `pnpm test`
Expected: 3 个新用例失败（第二个 spawn 不存在 / 未抛错）

- [ ] **Step 3: 实现 src/types.ts**

`NotifyConfig` 接口改为：

```ts
/** Plugin config: `enabled`, `title` and `sound`, all optional with defaults. */
export interface NotifyConfig {
  enabled?: boolean
  title?: string
  /** Play a system sound alongside the notification; default `true`. */
  sound?: boolean
}
```

- [ ] **Step 4: 实现 src/index.ts**

import 行加 `buildSoundCommands`：

```ts
import { buildBody, buildCommands, buildSoundCommands, isSupportedPlatform, resultText, spawnNotify } from './notify.js'
```

`apply` 内 `title` 校验之后新增 `sound` 校验：

```ts
  const sound = config.sound ?? true
  if (typeof sound !== 'boolean') {
    throw new Error(`dsh-notify-on-complete: config.sound must be a boolean, got ${typeof sound}`)
  }
```

`notify` 回调改为：

```ts
  const notifier = new RunEndNotifier({
    notify: (kind: string, sessionId: string): void => {
      spawnNotify(buildCommands(process.platform, title, buildBody(resultText(kind), sessionId)))
      if (sound) spawnNotify(buildSoundCommands(process.platform))
    },
  })
```

顶部 JSDoc 中 `@param config` 行同步更新为 `optional { enabled?, title?, sound? }`。

- [ ] **Step 5: 运行测试确认通过（绿）**

Run: `pnpm test`
Expected: 全部通过（37→40 用例）；现有 darwin 用例断言不变且通过

- [ ] **Step 6: 提交**

```bash
git add src/types.ts src/index.ts tests/index.spec.ts
git commit -m "feat: add sound config with fail-loud validation, wire Linux sound spawn"
```

---

### Task 3: README 文档更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 更新功能列表**

`src/index.ts` 顶部之外，README 的 bullet 列表（「跨平台」条目之后）追加一条：

```markdown
- 通知带系统提示音：macOS 用系统默认提示音（`sound name "Glass"`）、Windows 用 .NET SystemSounds、Linux 用 `canberra-gtk-play`（缺失时回退 `paplay`）；可用 `sound: false` 关闭。
```

- [ ] **Step 2: 更新配置表**

配置表格（`enabled` / `title` 两行的表格）追加一行：

```markdown
| `sound` | boolean | `true` | 通知时同时播放系统提示音；设为 `false` 只弹通知不出声 |
```

- [ ] **Step 3: 更新平台命令表**

平台命令表格追加「声音」列说明：

```markdown
| 平台 | 命令 | 备注 |
|---|---|---|
| macOS | `osascript -e 'display notification …'` | 原生通知中心通知，带系统提示音（`sound name "Glass"`） |
| Linux | `notify-send` | 缺失时自动回退 `kdialog --passivepopup`；提示音走 `canberra-gtk-play`（缺失时回退 `paplay`） |
| Windows | PowerShell `WScript.Shell.Popup` | 无需额外模块，5 秒自动关闭，带 .NET SystemSounds 提示音 |
```

- [ ] **Step 4: 检查改动是否完整**

Run: `grep -n "sound" README.md`
Expected: 至少 3 处（功能列表 / 配置表 / 平台命令表）

- [ ] **Step 5: 提交**

```bash
git add README.md
git commit -m "docs: document notification sound config and platform commands"
```

---

## 收尾

- [ ] 全量验证：`pnpm run typecheck && pnpm test`（预期 40 用例全绿）
- [ ] 手动验证（可选，macOS）：跑一次真实任务，确认通知 + 提示音；profile 配置 `sound: false` 后无声
- [ ] `git push origin main`
