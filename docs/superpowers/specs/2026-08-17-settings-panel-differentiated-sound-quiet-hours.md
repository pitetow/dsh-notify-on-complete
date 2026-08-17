# 设置面板 + 差异化声音 + 勿扰时段 设计

> Copyright (c) 2026 Luozy · SPDX-License-Identifier: MIT

日期：2026-08-17
状态：已批准

## 背景与目标

插件现有配置（`enabled` / `title` / `sound` / `onBlocked` / `onQuestion` / `onApproval`）只能通过 `cordis.patch.yml` 修改，用户学习成本高。目标：

1. **设置面板**：在 dsh Web GUI 设置界面直接可视化配置插件（不用改配置文件）。
2. **差异化声音**：完成 / 失败 / 提问审批用不同系统音色，面板可逐事件更换。
3. **勿扰时段**：指定时段内完全不弹通知（不弹不响），任务安静跑完。
4. **不做 webhook 推送**（用户明确决定，YAGNI）。

## 方案

### 1. 设置面板（官方 settings 机制，无需 client 半）

调研结论：`@deepseek-ai/dsh-settings` 提供 `installSettingsSection(ctx, ns, schema, entry, hooks)` —— host 侧注册 schemastery schema 后，**dsh Web 设置界面通过 `settings.describe()` 自动发现 namespace 并按 schema 自动渲染表单**（官方 `agent-default-model` 插件即此模式；`ui-settings` 客户端负责 schema 反序列化与表单渲染）。插件保持纯 host 结构。

**依赖**（peerDependencies，由 dsh CLI 提供）：
- `@deepseek-ai/dsh-settings`（^0.1.0-rc.5，与安装的 dsh 版本对齐）
- `@deepseek-ai/schemastery`（官方 fork，^3.x）

**新增 `src/settings.ts`**：

```ts
export const NOTIFY_SETTINGS_NAMESPACE = settingsNamespace('notify-on-complete')

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
```

接线（`src/index.ts` 的 `apply`）：

```ts
let current = config  // 组合入口 config 作为 fallback
installSettingsSection(ctx, NOTIFY_SETTINGS_NAMESPACE, NotifySettingsSchema, config, {
  setSource: (get) => { current = get() },
  onChange: () => {},
})
```

**取值优先级**：schema 默认值 → `cordis.patch.yml` config（`base` 层）→ 设置面板用户层。运行时所有行为通过 `current` 读取。

**fail-loud 校验**：保留现有 `apply` 里的入口 config 类型校验（面向未装设置服务的 CLI/headless 场景）；设置面板写入的值由 schema 校验，无需重复校验。

### 2. 差异化声音

**默认映射**（`kind` → 音色标识）：

| 事件 kind | 默认音色 | macOS | Linux (canberra) | Windows (SystemSounds) |
|---|---|---|---|---|
| `completed` | Glass | `sound name "Glass"` | `-i complete` | `Asterisk` |
| `error` | Sosumi | `sound name "Sosumi"` | `-i error` | `Exclamation` |
| `aborted` / `max-tokens` / `unknown` | 跟随 error 之外的通用音 | 见下 | 见下 | 见下 |
| 提问/审批（blocked/question/approval） | Ping | `sound name "Ping"` | `-i info` | `Question` |

设计：`kind` 归并为三档音色键 `completed` / `error` / `approval`：
- `turn/end` 的 `completed` → `completed`；`error`/`aborted`/`max-tokens`/`unknown` → `error` 档
- blocked 事件（`question` / `approval`）→ `approval` 档

**面板音色选项**（`sounds.{completed,error,approval}` 的取值）：macOS 系统音色名（`Glass` / `Sosumi` / `Ping` / `Funk` / `Basso` / `Pop` / `Heroine` / `Blow` / `Bottle` / `Frog`）+ `default`（该平台默认音）。设置值即音色标识，各平台构建命令时映射：
- macOS：`sound name "<标识>"`（标识本身是系统音色名，无需映射）
- Linux：固定映射表（Glass→complete、Sosumi→error、Ping→info、其他→complete 兜底），仍走 canberra→paplay 候选链
- Windows：固定映射表（Glass→Asterisk、Sosumi→Exclamation、Ping→Question、其他→Asterisk 兜底）

`buildSoundCommands(platform, kind, soundKey)` 签名扩展（或新增函数），保持现有 ENOENT 回退机制。

### 3. 勿扰时段

**新增 `src/quiet-hours.ts`**（纯函数）：

```ts
/** 解析 "HH:MM-HH:MM"（支持跨天），返回 [startMin, endMin]；非法输入返回 null。 */
export function parseQuietRange(spec: string): [number, number] | null
/** now 处于任一时段内（含跨天）返回 true。 */
export function isInQuietHours(now: Date, ranges: string[]): boolean
```

- 格式：`"HH:MM-HH:MM"`，24 小时制；`23:00-08:00` 跨天合法
- 时段内：`index.ts` 通知入口最前检查，命中即 return（不弹不响，连声音也不触发）
- 边界：开始时刻含（>=）、结束时刻不含（<）

### 4. 测试

- `tests/quiet-hours.spec.ts`：解析（合法/跨天/非法）、判断（时段内/外/跨天边界/空数组）
- `tests/notify.spec.ts`：三平台×三档音色的命令构建断言；音色映射兜底
- `tests/index.spec.ts`：设置覆盖（模拟 `current` 读取）、勿扰时段内不通知、差异化声音端到端
- `tests/settings.spec.ts`（新增）：schema 默认值、非法用户层被拒（如果可测）
- 现有 82 个测试保持通过

### 5. 文档（README）

- 设置面板说明（dsh Web 设置界面 → 插件设置）
- 配置表新增 `sounds` / `quietHours`
- 差异化声音与勿扰时段的行为说明

## 不做的事（YAGNI）

- 不做 webhook / IM 推送通道（用户决定）
- 不写 client 半（React 组件）——官方 settings 机制自动渲染
- 不做自定义音频文件路径（音色列表足够；`default` 兜底）
- 不做按工作日区分勿扰（字符串时段数组足够）

## 风险与兼容性

- `@deepseek-ai/dsh-settings` 的版本与 dsh CLI 对齐（^0.1.0-rc.5）；旧版 dsh 无此服务时 `installSettingsSection` 通过 `ctx.inject(['settings'])` 优雅降级（保持纯 config 工作），不影响安装。
- 现有 `cordis.patch.yml` 配置与设置面板并存：面板值优先，未设置的面板字段回退到 config。
