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
