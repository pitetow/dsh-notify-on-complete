# dsh-notify-on-complete 设计文档

日期：2026-08-14
状态：已批准

## 背景与目标

在独立安装的 dsh CLI（发布版，非 deepseek-harness 仓库源码）上，每次运行结束时向操作系统发送一条桌面通知，提示用户工作已完成。成功、失败、中止都要通知，正文按结果区分。

## 项目形态

- 独立项目，位于 `/Users/luozy/mainProject/dsh-notify-on-complete/`，与 deepseek-harness 仓库平级，不进入仓库。
- TypeScript + ESM（`"type": "module"`），Node ^22，构建产物为 ESM JS，供 dsh CLI 的 Loader 按包名 `dsh-notify-on-complete` 解析。
- **零运行时依赖**：peerDependencies 仅 `@deepseek-ai/cordis`（Loader 兼容与类型）。不依赖 `ctx.shell` 服务，直接用 Node `child_process.spawn(cmd, args, { detached: true, stdio: 'ignore' })` + `unref()` 发通知，fire-and-forget，teardown 阶段不受影响。
- 事件载荷用结构类型（`event.type === 'turn/end'`），不依赖 dsh 内部包，避免耦合未发布的内部包。

## 触发逻辑

- 监听全局 `session/event`，过滤 `event.type === 'turn/end'`，且只看**根会话**（`session.header.parentSession === undefined`，排除子代理会话），保证 CLI 一次运行只通知一次。
- `reason.kind` 映射正文：
  - `completed` → `任务已完成`
  - `error` → `任务失败`
  - `aborted` → `任务已中止`
  - `max-tokens` → `任务达到 token 上限`
  - 其他（union 可扩展）→ `任务结束`

## 通知格式与平台命令

标题可配置（默认 `DeepSeek Harness`），正文 = 结果文本 + 会话 ID（如 `任务已完成 (session: 3f9a…)`），按 `process.platform` 自动选择：

| 平台 | 命令 |
|---|---|
| macOS | `osascript -e 'display notification "<body>" with title "<title>"'` |
| Linux | `notify-send "<title>" "<body>"`（不存在时尝试 `kdialog --passivepopup` 兜底） |
| Windows | PowerShell `WScript.Shell.Popup` 弹窗（无需额外模块） |

命令以 detached 子进程 spawn 并 unref，不阻塞 harness 退出。

## 配置（cordis.yml 最小配置）

```yaml
- id: notify-on-complete
  name: dsh-notify-on-complete
  config:
    enabled: true              # 默认 true
    title: DeepSeek Harness    # 默认值
```

配置手动校验（非字符串/非布尔则启动即报错，fail loud），不引入 schemastery 依赖。

## 项目结构

```
dsh-notify-on-complete/
  package.json        # name: dsh-notify-on-complete, type: module, exports→lib/, peerDeps: @deepseek-ai/cordis
  tsconfig.json
  src/index.ts        # 插件入口：name/Config/apply + session/event 监听
  src/notify.ts       # 平台检测 + 命令构建 + detached spawn
  src/types.ts        # 配置与 turn/end reason 的结构类型
  tests/notify.spec.ts  # vitest：结果映射、平台命令构建、平台选择
  README.md           # 安装、cordis.yml 加载示例、各平台说明
  example.cordis.yml  # 可直接粘贴的配置片段
```

## 加载方式

独立 dsh CLI 的 Loader 需要能从 resolver 解析到 `dsh-notify-on-complete`。安装方式取决于 CLI 部署（npm 全局 / 二进制 / 其他），README 写明安装与加载步骤，`example.cordis.yml` 给出配置片段。

## 测试

- 单元测试（vitest）：reason→正文映射、各平台命令字符串、平台检测、spawn 参数。
- 手动验证：装到 CLI 后跑一次 `dsh "..."` 观察通知弹出。

## 不做的事（YAGNI）

- 不做通知点击跳转、不做耗时统计、不做跨平台 toast 模块依赖、不写 agent 注入/交互，不进入 deepseek-harness 仓库。
