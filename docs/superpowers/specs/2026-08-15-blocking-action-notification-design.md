# 会话中阻塞动作通知（Blocking-Action Notification）设计

> Copyright (c) 2026 Luozy · SPDX-License-Identifier: MIT

日期：2026-08-15
状态：已批准

## 背景与目标

当前插件只在一次运行**结束**（根 agent 回到 `idle`）时弹桌面通知。但会话进行中，模型经常停下等用户：调用 `ask_user_question` 提问、或沙箱提权/工具权限确认等待审批。此时用户若不在屏幕前，任务就无声地卡住。

目标：在会话中，每当出现「阻塞等待用户」的动作时**立即**弹一条桌面通知，提醒用户回来处理；同时保留现有「运行结束」通知不变。

## 触发信号（纯插件，不改 harness）

两类阻塞动作都通过 harness 的 `session/event` 总线暴露（插件已订阅该总线，无需新依赖）：

| 阻塞动作 | 会话事件 | 判定条件 | 通知正文 |
|---|---|---|---|
| 提问 | `tool/call` | `data.name === 'ask_user_question'` | `需要回答：<第一个问题文本>` |
| 审批/权限 | `approval/asked` | 事件本身即一次审批询问 | `需要批准：<toolName> — <reason>` |

- 提问文本：解析 `tool/call` 的 `data.arguments`（原始 JSON 字符串，模型产物）取出 `questions[0].question`，截断到 ~80 字符；`questions` 为空或 `question` 缺失时降级为 `需要回答`。
- 正文尾部沿用现有格式追加 `(session: <id>)`。
- 阻塞通知**即时**发出（每次阻塞一条），与「运行结束」通知（收敛到 `idle` 发一条）完全独立、互不干扰。
- 子代理过滤沿用现有口径（`header.origin === 'subagent'`），只对顶层会话通知。

### 时序正确性

- `tool/call` 在模型请求工具、**执行（阻塞）之前**由 `agent-loop` 落日志（`packages/core/agent-loop/src/tool-calls.ts` 的 `session.append('tool/call', ...)`），提问尚未阻塞即已通知。
- `approval/asked` 在 `ApprovalService.request()` 进入 answerer 链**之前**落日志（`packages/interaction/user-approval/src/index.ts`），审批尚未阻塞即已通知。

## 已知边界（文档化，不做 hack）

`approval/asked` 在「approval 策略 = never」或「无回答者（headless/CI）」时同样会落日志，此时实际是立即拒绝/关闭而非真正等用户。纯插件无法从 session 事件分辨这一层：

- Web GUI（本插件主要场景）回答者恒在、策略默认 `ask`，信号可靠。
- headless/CI 用户可用 `onBlocked: false` 或 `onApproval: false` 关闭。

此边界写入 README，不在代码里用时间差等 hack 规避。

## 配置项

沿用 `enabled`/`title`/`sound` 的 fail-loud 风格，全部布尔、加载时校验：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `onBlocked` | boolean | `true` | 阻塞通知总开关；`false` 完全关闭提问+审批通知 |
| `onQuestion` | boolean | `true` | 提问类（`ask_user_question`）通知开关 |
| `onApproval` | boolean | `true` | 审批/权限类通知开关 |

`onQuestion`/`onApproval` 仅在 `onBlocked=true` 时生效；任一类型值非布尔则 `apply` 抛错。

## 改动清单

### 1. `src/types.ts`

- 新增结构类型（零依赖、只读所需字段）：
  - `ToolCallData { name?: unknown; arguments?: unknown }`
  - `ApprovalAskedData { toolName?: unknown; reason?: unknown }`
- `NotifyConfig` 增加 `onBlocked?` / `onQuestion?` / `onApproval?`（均 `boolean`）。

### 2. `src/notify.ts`

- 新增 `blockedQuestionText(argumentsString: string): string`：`JSON.parse` 后取 `questions[0].question`，非字符串/为空/解析失败返回 `''`（调用方降级）；结果截断 ~80 字符。
- 新增 `blockedBody(kind, detail, sessionId): string`：`需要回答：<detail>` / `需要批准：<detail>` / `需要处理`（无 detail 时），尾部 `(session: <id>)`。

### 3. `src/notifier.ts`

- 新增 `BlockedNotifier`（与 `RunEndNotifier` 并列，不共享状态）：
  - `onSessionEvent(session, event)`：子代理过滤后，按 `event.type` 分流：
    - `tool/call` 且 `name === 'ask_user_question'` → 提取问题文本，`notify('question', detail, sessionId)`；
    - `approval/asked` → 拼 `toolName — reason`，`notify('approval', detail, sessionId)`；
    - 其余事件忽略。
  - 依赖注入 `notify(kind, detail, sessionId)`，与现有 `RunEndNotifier` 风格一致、便于单测。
- `RunEndNotifier` 不改。

### 4. `src/index.ts`

- 校验三个新配置字段（fail-loud，非布尔抛错）。
- `enabled=false` 或平台不支持时同样整体跳过。
- `session/event` 监听器同时喂给 `RunEndNotifier` 与 `BlockedNotifier`（后者仅在对应开关开启时实例化/调用）。
- `BlockedNotifier` 的 `notify` 回调：`spawnNotify(buildCommands(platform, title, blockedBody(...)))` + `sound` 开启时 `spawnNotify(buildSoundCommands(platform))`。
- 顶部 JSDoc 同步说明「运行结束 + 会话中阻塞」两类通知。

### 5. 测试

- `tests/notify.spec.ts`：
  - `blockedQuestionText`：正常提取首个问题、截断、坏 JSON 返回 `''`、`questions` 为空/`question` 非字符串返回 `''`。
  - `blockedBody`：question/approval/无 detail 三种正文 + session 尾部。
- `tests/notifier.spec.ts`（或新 `tests/blocked-notifier.spec.ts`）：
  - `tool/call` + `ask_user_question` → 触发 question 通知；其他 `tool/call` 名忽略。
  - `approval/asked` → 触发 approval 通知；非阻塞事件（`turn/end` 等）忽略。
  - 子代理 `origin === 'subagent'` → 不触发。
- `tests/index.spec.ts`：
  - 默认配置下阻塞事件触发一次通知 spawn；`onBlocked:false` / `onQuestion:false` / `onApproval:false` 各自关闭对应通知。
  - 非布尔配置抛错。

### 6. 文档（README）

- 功能列表：会话中提问/审批时即时通知。
- 配置表：新增 `onBlocked` / `onQuestion` / `onApproval` 三行。
- 「已知边界」说明 `approval/asked` 在 never 策略/无回答者下的误报与规避方式。

## 错误处理

- 通知仍是 fire-and-forget（`detached` + `unref`），失败不抛、绝不影响 harness 运行（复用现有 `spawnNotify`）。
- `arguments` 解析失败或结构不符 → 降级为通用正文，不 crash。
- 阻塞通知与运行结束通知各自独立，一方失败不影响另一方。

## 不做的事（YAGNI）

- 不改 harness（不加干净事件、不改 answerer）。
- 不做「用户已回答/已解除阻塞」的二次通知——结束通知已覆盖最终结果。
- 不做通知去重/防抖——每次提问或审批各一条，正是期望行为。
- 不做 headless 误报的运行时规避（时间差、策略嗅探等 hack）——只文档化 + 配置开关。
- 不新增独立插件——扩展现有 `dsh-notify-on-complete`。

## 测试与验证

- `pnpm run typecheck && pnpm test` 全绿。
- 手动验证：Web GUI 跑一个会调用 `ask_user_question` 的任务，确认提问时立即弹通知、正文含问题文本；跑一个触发沙箱提权的任务，确认审批时弹通知。
- 回归：运行结束通知仍只在 `idle` 时弹一条，多轮 goal run 不刷屏。
