# 会话中阻塞动作通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在会话进行中，每当出现阻塞等待用户的动作（模型调用 `ask_user_question` 提问、或沙箱提权/工具权限触发 `approval/asked` 审批）时立即弹一条桌面通知，提醒用户回来处理；现有「运行结束」通知保持不变。

**Architecture:** 纯插件、不改 harness。复用 `session/event` 总线：`tool/call`（`name === 'ask_user_question'`）判定提问，`approval/asked` 判定审批。新增 `BlockedNotifier`（与 `RunEndNotifier` 并列，即时逐条通知），`notify.ts` 新增 `blockedQuestionText`（解析 `arguments` 取问题文本）与 `blockedBody`（拼正文）。配置新增 `onBlocked`/`onQuestion`/`onApproval` 三个布尔开关，fail-loud 校验。

**Tech Stack:** TypeScript (strict, ESM, NodeNext)、vitest、node:child_process

## Global Constraints

- 所有代码文件保持版权头（`Copyright (c) 2026 Luozy` / `SPDX-License-Identifier: MIT`）。
- 不引入任何新依赖；不改 harness；不改 `RunEndNotifier` 与现有通知命令/声音回退语义。
- 阻塞通知仍是 fire-and-forget（复用 `spawnNotify`，`detached` + `unref`），失败静默、绝不抛错。
- 子代理过滤沿用 `session.header.origin === 'subagent'`，只对顶层会话通知。
- 现有 40 个测试断言（尤其 darwin 平台 spawn 次数、`enabled:false` 不注册）必须保持通过。
- 审批 `approval/asked` 在「never 策略 / 无回答者」下也会落日志（实际立即拒绝而非等用户），此误报只在 README 文档化，不做运行时 hack 规避。

---

### Task 1: notify.ts 纯函数（blockedQuestionText + blockedBody）+ 测试

**Files:**
- Modify: `src/notify.ts`（文件末尾追加两个导出函数）
- Modify: `tests/notify.spec.ts`

**Interfaces:**
- Consumes: 无新依赖（仅 `JSON.parse`）。
- Produces:
  - `blockedQuestionText(argumentsString: string): string` —— 解析 `ask_user_question` 的 `arguments` JSON，取 `questions[0].question`，trim、截断到 80 字符；坏 JSON / 无问题 / 非字符串返回 `''`。
  - `blockedBody(kind: string, detail: string, sessionId: string): string` —— `需要回答：<detail>` / `需要批准：<detail>`，`detail` 为空回退 `需要处理`，尾部 `(session: <id>)`。

- [ ] **Step 1: 写失败测试（红）**

在 `tests/notify.spec.ts` 顶部 import 列表追加 `blockedBody`、`blockedQuestionText`：

```ts
import { blockedBody, blockedQuestionText, buildBody, buildCommands, buildSoundCommands, isSupportedPlatform, resultText, spawnNotify } from '../src/notify.js'
```

在文件末尾（`spawnNotify` 的 describe 块闭合之后）新增两个 describe 块：

```ts
describe('blockedQuestionText', () => {
  it('extracts the first question text', () => {
    expect(blockedQuestionText('{"questions":[{"id":"a","question":"要如何？"},{"id":"b","question":"第二个"}]}')).toBe('要如何？')
  })

  it('truncates long questions to 80 chars with an ellipsis', () => {
    const long = '问'.repeat(100)
    expect(blockedQuestionText(`{"questions":[{"question":"${long}"}]}`)).toBe(`${'问'.repeat(80)}…`)
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
})
```

- [ ] **Step 2: 运行测试确认失败（红）**

Run: `pnpm test`
Expected: 新增 7 个用例失败（`blockedQuestionText is not a function` / `blockedBody is not a function`）

- [ ] **Step 3: 实现 src/notify.ts**

在 `src/notify.ts` 文件末尾（`spawnNotify` 函数之后）追加：

```ts
/** Maximum length of a question's text carried into a notification body. */
const QUESTION_TEXT_MAX = 80

/**
 * Extract the first question's text from an `ask_user_question` tool call's
 * raw `arguments` JSON string, trimmed and truncated for a notification body.
 * Returns an empty string when the JSON is malformed or the text is absent.
 * @param argumentsString - the raw `arguments` string from a `tool/call` event.
 * @returns the first question's trimmed text, truncated to {@link QUESTION_TEXT_MAX} chars.
 */
export function blockedQuestionText(argumentsString: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsString)
  } catch {
    return ''
  }
  const questions = (parsed as { questions?: unknown } | undefined)?.questions
  if (!Array.isArray(questions) || questions.length === 0) return ''
  const question = (questions[0] as { question?: unknown } | undefined)?.question
  if (typeof question !== 'string' || question.trim() === '') return ''
  const text = question.trim()
  return text.length > QUESTION_TEXT_MAX ? `${text.slice(0, QUESTION_TEXT_MAX)}…` : text
}

/**
 * Build a blocking-action notification body: a kind label plus the extracted
 * detail, with the session id appended. An empty detail falls back to the
 * generic "needs attention" text.
 * @param kind - `'question'` or `'approval'`.
 * @param detail - the extracted question text, or `toolName — reason`.
 * @param sessionId - the root session id to append.
 * @returns the final notification body.
 */
export function blockedBody(kind: string, detail: string, sessionId: string): string {
  if (detail === '') return `需要处理 (session: ${sessionId})`
  const label = kind === 'question' ? '需要回答' : kind === 'approval' ? '需要批准' : '需要处理'
  return `${label}：${detail} (session: ${sessionId})`
}
```

- [ ] **Step 4: 运行测试确认通过（绿）**

Run: `pnpm test`
Expected: 全部通过（notify.spec 由 17 → 24 用例）

- [ ] **Step 5: 提交**

```bash
git add src/notify.ts tests/notify.spec.ts
git commit -m "feat: add blocked-question/approval body builders"
```

---

### Task 2: types.ts 类型 + notifier.ts BlockedNotifier + 测试

**Files:**
- Modify: `src/types.ts`（新增事件数据类型 + 配置字段）
- Modify: `src/notifier.ts`（新增 `BlockedNotifier` 类）
- Modify: `tests/notifier.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `blockedQuestionText`。
- Produces:
  - `ToolCallData { name?: unknown; arguments?: unknown }`、`ApprovalAskedData { toolName?: unknown; reason?: unknown }`。
  - `NotifyConfig` 增加 `onBlocked?` / `onQuestion?` / `onApproval?`（均 boolean）。
  - `BlockedNotifier`：`onSessionEvent(session, event)` 即时判定并 `notify(kind, detail, sessionId)`；构造注入 `{ notify, onQuestion, onApproval }`。

- [ ] **Step 1: 写失败测试（红）**

`tests/notifier.spec.ts` 顶部 import 改为：

```ts
import { BlockedNotifier, RunEndNotifier } from '../src/notifier.js'
```

在 `rootSession` / `subagentSession` / `turnEnd` 辅助函数之后，新增两个事件辅助函数和 `makeBlockedNotifier`：

```ts
function toolCall(name: string, args = '{}'): SessionEvent {
  return { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name, arguments: args } }
}

function approvalAsked(toolName: string, reason?: string): SessionEvent {
  return { type: 'approval/asked', data: { id: 'a1', toolName, ...(reason === undefined ? {} : { reason }) } }
}

function makeBlockedNotifier(onQuestion = true, onApproval = true, notify = vi.fn()) {
  return { notifier: new BlockedNotifier({ notify, onQuestion, onApproval }), notify }
}
```

在文件末尾（`RunEndNotifier` 的 describe 闭合 `})` 之后）新增 describe 块：

```ts
describe('BlockedNotifier', () => {
  it('notifies on an ask_user_question tool call with the question text', () => {
    const { notifier, notify } = makeBlockedNotifier()
    notifier.onSessionEvent(rootSession(), toolCall('ask_user_question', '{"questions":[{"question":"要如何？"}]}'))
    expect(notify).toHaveBeenCalledWith('question', '要如何？', 'root')
  })

  it('notifies on an approval/asked event with tool name and reason', () => {
    const { notifier, notify } = makeBlockedNotifier()
    notifier.onSessionEvent(rootSession(), approvalAsked('bash', 'escalate sandbox'))
    expect(notify).toHaveBeenCalledWith('approval', 'bash — escalate sandbox', 'root')
  })

  it('omits the reason when approval/asked has none', () => {
    const { notifier, notify } = makeBlockedNotifier()
    notifier.onSessionEvent(rootSession(), approvalAsked('bash'))
    expect(notify).toHaveBeenCalledWith('approval', 'bash', 'root')
  })

  it('ignores non-ask-user tool calls', () => {
    const { notifier, notify } = makeBlockedNotifier()
    notifier.onSessionEvent(rootSession(), toolCall('bash'))
    expect(notify).not.toHaveBeenCalled()
  })

  it('ignores other event types', () => {
    const { notifier, notify } = makeBlockedNotifier()
    notifier.onSessionEvent(rootSession(), turnEnd('completed'))
    notifier.onSessionEvent(rootSession(), { type: 'assistant/message', data: {} })
    expect(notify).not.toHaveBeenCalled()
  })

  it('does not notify subagent sessions', () => {
    const { notifier, notify } = makeBlockedNotifier()
    notifier.onSessionEvent(subagentSession('child'), toolCall('ask_user_question', '{"questions":[{"question":"x"}]}'))
    notifier.onSessionEvent(subagentSession('child'), approvalAsked('bash'))
    expect(notify).not.toHaveBeenCalled()
  })

  it('respects the onQuestion and onApproval switches', () => {
    const q = makeBlockedNotifier(false, true)
    q.notifier.onSessionEvent(rootSession(), toolCall('ask_user_question', '{"questions":[{"question":"x"}]}'))
    expect(q.notify).not.toHaveBeenCalled()

    const a = makeBlockedNotifier(true, false)
    a.notifier.onSessionEvent(rootSession(), approvalAsked('bash'))
    expect(a.notify).not.toHaveBeenCalled()
  })

  it('reports an empty detail when arguments are malformed', () => {
    const { notifier, notify } = makeBlockedNotifier()
    notifier.onSessionEvent(rootSession(), toolCall('ask_user_question', 'not json'))
    expect(notify).toHaveBeenCalledWith('question', '', 'root')
  })
})
```

- [ ] **Step 2: 运行测试确认失败（红）**

Run: `pnpm test`
Expected: 新增 8 个用例失败（`BlockedNotifier is not a function` 或 `is not a constructor`）

- [ ] **Step 3: 实现 src/types.ts**

在 `src/types.ts` 的 `SessionEvent` 接口之后新增两个结构类型：

```ts
/** The `tool/call` event data fields this plugin reads. */
export interface ToolCallData {
  name?: unknown
  arguments?: unknown
}

/** The `approval/asked` event data fields this plugin reads. */
export interface ApprovalAskedData {
  toolName?: unknown
  reason?: unknown
}
```

把 `NotifyConfig` 接口改为：

```ts
/** Plugin config: `enabled`, `title`, `sound` and the blocking-action switches, all optional with defaults. */
export interface NotifyConfig {
  enabled?: boolean
  title?: string
  /** Play a system sound alongside the notification; default `true`. */
  sound?: boolean
  /** Notify on blocking user-interactions (questions + approvals); default `true`. */
  onBlocked?: boolean
  /** Notify when the model asks a question (`ask_user_question`); default `true`. */
  onQuestion?: boolean
  /** Notify when the harness waits for approval; default `true`. */
  onApproval?: boolean
}
```

- [ ] **Step 4: 实现 src/notifier.ts**

`src/notifier.ts` 顶部 import 改为：

```ts
import { blockedQuestionText } from './notify.js'
import type { AgentStatusPayload, ApprovalAskedData, Session, SessionEvent, ToolCallData } from './types.js'
```

在文件末尾（`RunEndNotifier` 类之后）追加：

```ts
/**
 * Fires one notification per blocking user-interaction as it happens: a
 * question (`tool/call` naming `ask_user_question`) or an approval ask
 * (`approval/asked`). Unlike {@link RunEndNotifier}, it reports immediately on
 * each event — no aggregation — because each ask is a separate "the session is
 * waiting on the user" moment. Subagent sessions are excluded via
 * `header.origin === 'subagent'`, and the `onQuestion` / `onApproval` switches
 * let the plugin turn one class off without touching the other.
 */
export class BlockedNotifier {
  constructor(private readonly deps: {
    /** Emit one notification for a blocking action. */
    notify: (kind: string, detail: string, sessionId: string) => unknown
    onQuestion: boolean
    onApproval: boolean
  }) {}

  /** Feed `session/event`; report blocking interactions on root sessions only. */
  onSessionEvent(session: Session, event: SessionEvent): void {
    if (session.header.origin === 'subagent') return
    if (event.type === 'tool/call' && this.deps.onQuestion) {
      const data = event.data as ToolCallData | undefined
      if (data?.name !== 'ask_user_question') return
      const detail = typeof data.arguments === 'string' ? blockedQuestionText(data.arguments) : ''
      this.deps.notify('question', detail, session.header.id)
    } else if (event.type === 'approval/asked' && this.deps.onApproval) {
      const data = event.data as ApprovalAskedData | undefined
      const toolName = typeof data?.toolName === 'string' ? data.toolName : ''
      const reason = typeof data?.reason === 'string' ? data.reason : ''
      const detail = toolName === '' ? '' : reason === '' ? toolName : `${toolName} — ${reason}`
      this.deps.notify('approval', detail, session.header.id)
    }
  }
}
```

- [ ] **Step 5: 运行测试确认通过（绿）**

Run: `pnpm test`
Expected: 全部通过（notifier.spec 由 11 → 19 用例）

- [ ] **Step 6: 提交**

```bash
git add src/types.ts src/notifier.ts tests/notifier.spec.ts
git commit -m "feat: add BlockedNotifier for question and approval asks"
```

---

### Task 3: index.ts 配置校验 + 接线 + 测试

**Files:**
- Modify: `src/index.ts`
- Modify: `tests/index.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `blockedBody`、Task 2 的 `BlockedNotifier` 与 `NotifyConfig` 新字段。
- Produces: `apply` 校验三个新布尔字段（fail-loud）；`onBlocked` 为 true 时实例化 `BlockedNotifier`，`session/event` 同时喂给两个 notifier。

- [ ] **Step 1: 写失败测试（红）**

在 `tests/index.spec.ts` 的 `idleSubagent` 辅助函数之后新增两个辅助函数：

```ts
function rootToolCall(name: string, args = '{}'): unknown[] {
  return [{ header: { id: 'root' } }, { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name, arguments: args } }]
}

function rootApprovalAsked(toolName: string, reason?: string): unknown[] {
  return [{ header: { id: 'root' } }, { type: 'approval/asked', data: { id: 'a1', toolName, ...(reason === undefined ? {} : { reason }) } }]
}
```

在 `apply` 的 describe 块末尾（最后一个 `it` 之后、闭合 `})` 之前）新增用例：

```ts
  it('notifies immediately on an ask_user_question tool call', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('session/event', ...rootToolCall('ask_user_question', '{"questions":[{"question":"要如何？"}]}'))
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).toContain('需要回答：要如何？ (session: root)')
  })

  it('notifies immediately on an approval/asked event', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('session/event', ...rootApprovalAsked('bash', 'escalate sandbox'))
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).toContain('需要批准：bash — escalate sandbox (session: root)')
  })

  it('does not notify blocked events for subagent sessions', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('session/event', { header: { id: 'child', origin: 'subagent' } }, { type: 'tool/call', data: { name: 'ask_user_question', arguments: '{}' } })
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  it('disables blocked notifications when onBlocked is false', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx, { onBlocked: false })
    ctx.emit('session/event', ...rootToolCall('ask_user_question', '{"questions":[{"question":"x"}]}'))
    ctx.emit('session/event', ...rootApprovalAsked('bash'))
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  it('disables only questions when onQuestion is false', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx, { onQuestion: false })
    ctx.emit('session/event', ...rootToolCall('ask_user_question', '{"questions":[{"question":"x"}]}'))
    expect(mockedSpawn).not.toHaveBeenCalled()
    ctx.emit('session/event', ...rootApprovalAsked('bash'))
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
  })

  it('disables only approvals when onApproval is false', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx, { onApproval: false })
    ctx.emit('session/event', ...rootApprovalAsked('bash'))
    expect(mockedSpawn).not.toHaveBeenCalled()
    ctx.emit('session/event', ...rootToolCall('ask_user_question', '{"questions":[{"question":"x"}]}'))
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
  })

  it('fails loud on non-boolean onBlocked/onQuestion/onApproval', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    expect(() => apply(ctx, { onBlocked: 1 as unknown as NotifyConfig['onBlocked'] })).toThrow(/config\.onBlocked must be a boolean/)
    expect(() => apply(ctx, { onQuestion: 1 as unknown as NotifyConfig['onQuestion'] })).toThrow(/config\.onQuestion must be a boolean/)
    expect(() => apply(ctx, { onApproval: 1 as unknown as NotifyConfig['onApproval'] })).toThrow(/config\.onApproval must be a boolean/)
  })
```

- [ ] **Step 2: 运行测试确认失败（红）**

Run: `pnpm test`
Expected: 新增 7 个用例失败（阻塞事件不产生 spawn / 非布尔未抛错）

- [ ] **Step 3: 实现 src/index.ts**

`src/index.ts` 顶部 import 改为：

```ts
import type { Context } from '@deepseek-ai/cordis'
import { blockedBody, buildBody, buildCommands, buildSoundCommands, isSupportedPlatform, resultText, spawnNotify } from './notify.js'
import { BlockedNotifier, RunEndNotifier } from './notifier.js'
import type { AgentStatusPayload, NotifyConfig, Session, SessionEvent } from './types.js'
```

在 `sound` 校验之后、`if (!enabled) return` 之前，追加三个新字段校验：

```ts
  const onBlocked = config.onBlocked ?? true
  if (typeof onBlocked !== 'boolean') {
    throw new Error(`dsh-notify-on-complete: config.onBlocked must be a boolean, got ${typeof onBlocked}`)
  }
  const onQuestion = config.onQuestion ?? true
  if (typeof onQuestion !== 'boolean') {
    throw new Error(`dsh-notify-on-complete: config.onQuestion must be a boolean, got ${typeof onQuestion}`)
  }
  const onApproval = config.onApproval ?? true
  if (typeof onApproval !== 'boolean') {
    throw new Error(`dsh-notify-on-complete: config.onApproval must be a boolean, got ${typeof onApproval}`)
  }
```

在 `const notifier = new RunEndNotifier({...})` 之后，新增 `blockedNotifier`（`onBlocked` 为 false 时保持 `undefined`）：

```ts
  const blockedNotifier = onBlocked ? new BlockedNotifier({
    notify: (kind: string, detail: string, sessionId: string): void => {
      spawnNotify(buildCommands(process.platform, title, blockedBody(kind, detail, sessionId)))
      if (sound) spawnNotify(buildSoundCommands(process.platform))
    },
    onQuestion,
    onApproval,
  }) : undefined
```

把 `session/event` 监听器改为同时喂给两个 notifier：

```ts
  register('session/event', (...args: unknown[]): void => {
    const session = args[0] as Session
    const event = args[1] as SessionEvent
    notifier.onSessionEvent(session, event)
    blockedNotifier?.onSessionEvent(session, event)
  })
```

顶部 JSDoc 的 `@param config` 行同步更新为 `optional { enabled?, title?, sound?, onBlocked?, onQuestion?, onApproval? }`，并在说明里补一句「会话中提问/审批时即时通知」。

- [ ] **Step 4: 运行测试确认通过（绿）**

Run: `pnpm test`
Expected: 全部通过（index.spec 由 12 → 19 用例；现有「运行结束」用例 spawn 次数不受影响）

- [ ] **Step 5: 提交**

```bash
git add src/index.ts tests/index.spec.ts
git commit -m "feat: wire blocked-action notifications with fail-loud config switches"
```

---

### Task 4: README 文档更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 更新开篇与功能列表**

开篇第 3 行改为：

```markdown
DeepSeek Harness 插件：每次 dsh 运行结束时向操作系统发送桌面通知，提示用户工作已完成；会话进行中模型提问或等待审批时也会即时通知提醒你回来处理。正文按结果区分（成功 / 失败 / 中止 / 达到 token 上限）。
```

功能列表（「通知带系统提示音」条目之后）追加一条：

```markdown
- 会话中阻塞即时通知：模型调用 `ask_user_question` 提问、或沙箱提权/工具权限等待审批时立即弹通知提醒你回来（正文含问题文本 / 工具名与原因），可用 `onBlocked` / `onQuestion` / `onApproval` 精细控制。
```

- [ ] **Step 2: 更新配置表**

配置表格（`sound` 一行之后）追加三行：

```markdown
| `onBlocked` | boolean | `true` | 阻塞通知总开关；设为 `false` 完全关闭提问+审批通知 |
| `onQuestion` | boolean | `true` | 提问类（`ask_user_question`）通知开关；仅在 `onBlocked: true` 时生效 |
| `onApproval` | boolean | `true` | 审批/权限类通知开关；仅在 `onBlocked: true` 时生效 |
```

- [ ] **Step 3: 常见问题追加一条**

在「常见问题」末尾追加：

```markdown
**Q：headless / approval 策略为 never 时也会弹「需要批准」吗？**
可能。`approval/asked` 在策略为 never 或没有回答者（headless/CI）时同样会落日志，此时实际是立即拒绝而非真正等用户——纯插件无法从 session 事件分辨这一层。Web GUI 回答者恒在、策略默认 ask，信号可靠；headless 场景可用 `onApproval: false` 或 `onBlocked: false` 关闭。
```

- [ ] **Step 4: 检查改动是否完整**

Run: `grep -n "onBlocked\|onQuestion\|onApproval" README.md`
Expected: 配置表三行 + 功能列表一处 + FAQ 一处，共 ≥ 5 处

- [ ] **Step 5: 提交**

```bash
git add README.md
git commit -m "docs: document blocking-action notifications and config switches"
```

---

## 收尾

- [ ] 全量验证：`pnpm run typecheck && pnpm test`（预期全绿，新增 22 个用例，现有 40 个不回归）
- [ ] 构建验证：`pnpm run build`（确认 `lib/` 产物生成、`add-header.mjs` 正常）
- [ ] 手动验证（可选，Web GUI）：跑一个会调用 `ask_user_question` 的任务，确认提问时立即弹通知、正文含问题文本；跑一个触发沙箱提权的任务，确认审批时弹通知；回归「运行结束」通知仍在 `idle` 时弹一条
- [ ] `git push origin main`
