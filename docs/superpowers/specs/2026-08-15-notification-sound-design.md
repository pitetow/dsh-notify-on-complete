# 通知提示音（Notification Sound）设计

> Copyright (c) 2026 Luozy · SPDX-License-Identifier: MIT

日期：2026-08-15
状态：已批准

## 背景与目标

当前插件在 dsh 运行结束时弹桌面通知，但无声音。目标是通知弹出的同时播放系统提示音，提醒用户工作已完成（尤其适合任务在后台时）。

## 方案（已选定：方案 A）

平台原生命令内嵌声音 + Linux 独立声音链：

| 平台 | 声音机制 | 实现位置 |
|---|---|---|
| macOS | `osascript` 的 `sound name "Glass"` 参数（原生） | 内嵌进现有通知命令 |
| Windows | PowerShell 追加 `[System.Media.SystemSounds]::Asterisk.Play()`（.NET 内置） | 内嵌进现有通知命令 |
| Linux | `canberra-gtk-play -i complete` → `paplay /usr/share/sounds/freedesktop/stereo/complete.oga` 候选链 | 新增独立命令链 |

不做方案 B（三平台统一独立 spawn：macOS/Windows 多起子进程、更慢）、方案 C（只做 macOS：放弃跨平台）。

## 改动清单

### 1. `src/notify.ts`

- **macOS 命令**：`display notification "<body>" with title "<title>"` 追加 `sound name "Glass"`。
- **Windows 命令**：PowerShell 尾部追加 `[System.Media.SystemSounds]::Asterisk.Play()`（分号连接）。
- **新增 `buildSoundCommands(platform: NodeJS.Platform): NotifyCommand[]`**：
  - `linux` → `[{ canberra-gtk-play, [-i, complete] }, { paplay, [/usr/share/sounds/freedesktop/stereo/complete.oga] }]`
  - `darwin` / `win32` → `[]`（声音已内嵌在通知命令中）

### 2. `src/index.ts`

`notify` 回调在 `spawnNotify(buildCommands(...))` 之后追加 `spawnNotify(buildSoundCommands(platform))`。空数组时 `spawnNotify` 直接返回，零开销。

### 3. `src/types.ts` + `src/index.ts`（配置）

- `NotifyConfig` 增加 `sound?: boolean`，默认 `true`（`const sound = config.sound ?? true`）。
- 沿用现有 fail-loud 风格：非布尔时 `apply` 抛错。
- 顶部 JSDoc 同步说明。

### 4. 测试

- `tests/notify.spec.ts`：
  - macOS 断言追加 `sound name "Glass"`；Windows 断言追加 `.Play()`。
  - 新增 `buildSoundCommands`：linux 返回 canberra→paplay 候选链；darwin/win32 返回空数组。
- `tests/index.spec.ts`：
  - 新增：linux 平台默认 `sound` 开启 → 通知 spawn 之外额外 spawn 一次声音命令。
  - 新增：`sound: false` → 不 spawn 声音命令。
  - 现有断言不改（darwin 下声音数组为空，不产生额外 spawn）。
- `tests/notifier.spec.ts`：不动。

### 5. 文档（README）

- 功能列表：通知带系统提示音。
- 配置表：新增 `sound` 行（boolean，默认 `true`，`false` 关闭声音）。
- 平台命令表：macOS 注明 `sound name "Glass"`、Windows 注明 SystemSounds、Linux 注明 canberra→paplay 回退。

## 错误处理

声音是附加体验，遵循插件既有的 fire-and-forget 原则：

- 命令缺失（ENOENT）→ 按 `spawnNotify` 现有机制回退下一个候选；无候选则静默。
- 播放失败（命令存在但无声音设备/文件缺失）→ 静默，不重试、不抛错、不影响通知与运行。
- 可覆盖边界：ENOENT 回退只覆盖"命令缺失"，不覆盖"播放失败"——声音失败不能影响通知主体，这是有意的取舍。

## 不做的事（YAGNI）

- 不做声音自定义配置（如指定音效文件/名称）——`sound: false` 开关足够，Glass/Asterisk/complete 均为各平台系统默认提示音。
- 不做三平台统一声音实现（方案 B）。
- 不改动通知命令的回退语义（`notify-send` → `kdialog` 仍只对通知本体生效）。

## 测试与验证

- `pnpm run typecheck && pnpm test` 全绿。
- 手动验证：macOS 实机跑一次 `dsh --profile headless "任务"`，确认通知弹出 + 提示音；`sound: false` 后无声。
