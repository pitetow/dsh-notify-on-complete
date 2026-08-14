# dsh-notify-on-complete

DeepSeek Harness 插件：每次 dsh 运行结束时向操作系统发送桌面通知，提示用户工作已完成。正文按结果区分（成功 / 失败 / 中止 / 达到 token 上限）。

- 零运行时依赖：不依赖 dsh 内部包，也不依赖 `ctx.shell` 服务，通知用 `child_process.spawn` 以 detached 子进程发出，**不阻塞、也不被 harness 退出流程影响**。
- 跨平台：按 `process.platform` 自动选择通知命令（macOS `osascript` / Linux `notify-send` / Windows PowerShell）。
- 只通知顶层运行：子代理（subagent）会话被过滤，一次 CLI 运行只弹一条通知。

## 工作原理

插件监听全局 `session/event` 事件流，过滤 `turn/end` 事件，且只看**根会话**（`session.header.parentSession === undefined`，子代理会话带 parentSession，被排除）。然后按 `reason.kind` 映射正文，通过系统命令发送通知：

| `reason.kind` | 通知正文 |
|---|---|
| `completed` | 任务已完成 |
| `error` | 任务失败 |
| `aborted` | 任务已中止 |
| `max-tokens` | 任务达到 token 上限 |
| 其他（未知） | 任务结束 |

通知正文格式：`结果文本 (session: 会话ID)`，例如 `任务已完成 (session: 3f9a…)`。通知命令以 `detached: true` + `unref()` 发出，harness 正常退出或崩溃都不会影响通知送达。

## 环境要求

- Node.js ^22（与 DeepSeek Harness 一致）
- 已安装的 dsh CLI（任意版本，插件通过 Cordis 事件注册，不依赖 CLI 特定版本）
- peer 依赖 `@deepseek-ai/cordis@^4.0.1`（由 dsh CLI 自身提供，安装时 pnpm 会自动解析）

---

## 安装

dsh CLI 的插件通过**用户级 profile** 加载：profile 目录在 `~/.dsh/profiles/<profile名>/`，其中 `cordis.patch.yml` 是用户层配置，`package.json` 的 dependencies 是 Loader 解析 bare 插件名的依据。安装分两步：**① 把包装进 profile → ② 在用户层声明插件条目**。

### 第 1 步：构建插件

```bash
cd /path/to/dsh-notify-on-complete
pnpm install
pnpm run build   # 产物输出到 lib/
```

### 第 2 步：把插件安装进 profile

用 `dsh plugin` 子命令（它会在 profile 目录内转发给 pnpm，并把包名写进 profile 的依赖清单）：

```bash
# 本地源码形式（推荐开发期使用；link: 是符号链接，改代码后重建即生效）
dsh plugin --profile web add link:/path/to/dsh-notify-on-complete

# 或者用 file: 形式（pnpm 复制安装，适合不打算改插件源码时）
dsh plugin --profile web add file:/path/to/dsh-notify-on-complete
```

> profile 名可以是 `web`、`headless` 或你自定义的任意 profile。用 `dsh --profile <名字>` 启动哪个，就装进哪个。

装完后检查 `~/.dsh/profiles/web/package.json`，dependencies 里应出现 `dsh-notify-on-complete`：

```bash
grep dsh-notify ~/.dsh/profiles/web/package.json
```

> 预期会看到一行提示：`dsh: warning: dsh-notify-on-complete declares no dsh.bundle — installed as a plain dependency, not a profile layer`。这是**正常的**——本插件是普通功能插件（function plugin），不需要成为 bundle 层，这条警告只是说明它不会自动加入层叠，需要第 3 步手动声明。

### 第 3 步：在用户层声明插件条目

编辑 `~/.dsh/profiles/web/cordis.patch.yml`（当前是空的 `[]`），加入：

```yaml
# 你的 profile 用户层（cordis.patch.yml）
- id: notify-on-complete
  name: dsh-notify-on-complete
  config:
    enabled: true              # 默认 true，不写也行
    title: DeepSeek Harness    # 通知标题，不写也行
```

### 第 4 步：重启 dsh 进程

`cordis.patch.yml` 的变更需要 dsh 进程重新加载：

- **CLI 一次性运行**：下次运行 `dsh --profile headless "任务"` 时自然生效，无需额外操作。
- **Web GUI**：重启 web 进程（结束当前 `dsh web` 进程后重新启动）。若部署启用了 `cordis.patch.yml` 的 HMR 热更新，保存文件后会自动生效。

### 第 5 步：验证已加载

```bash
dsh --profile web --dump-config | grep -n notify-on-complete
```

能输出 `- id: notify-on-complete` 及其后的 `name: dsh-notify-on-complete` 行，说明插件条目已进入合成树。再跑一次真实任务，看到桌面通知弹出即安装成功。

---

## 配置

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `enabled` | boolean | `true` | 设为 `false` 时插件不注册任何监听，完全关闭 |
| `title` | string | `DeepSeek Harness` | 系统通知的标题 |

配置校验在加载时执行（fail loud）：类型错误会在启动时报错，不会静默忽略。

## 平台命令

| 平台 | 命令 | 备注 |
|---|---|---|
| macOS | `osascript -e 'display notification …'` | 原生通知中心通知 |
| Linux | `notify-send` | 缺失时自动回退 `kdialog --passivepopup` |
| Windows | PowerShell `WScript.Shell.Popup` | 无需额外模块，5 秒自动关闭 |

> macOS 首次使用可能需要给终端应用授予"通知"权限（系统设置 → 通知）。

## 卸载

```bash
# 1. 从 cordis.patch.yml 删除第 3 步加的条目
# 2. 从 profile 移除依赖
dsh plugin --profile web remove dsh-notify-on-complete
# 3. 重启 dsh 进程
```

## 常见问题

**Q：装了但通知不弹？**
1. 先确认加载成功：`dsh --profile web --dump-config | grep notify-on-complete`。
2. 确认跑的是根会话任务（CLI 一次性运行一定满足；子代理/后台子任务不触发）。
3. macOS 检查通知权限；Linux 确认有 `notify-send` 或 `kdialog`；Windows 确认 PowerShell 可用。
4. 通知是 fire-and-forget 的，失败不会报错——可以在终端手动执行对应平台的命令验证系统侧可用。

**Q：为什么只在根会话触发，子代理不通知？**
CLI 一次运行可能包含多个子代理会话，每个都有自己的 `turn/end`。插件只看根会话（无 `parentSession` 头），保证一次运行只弹一条通知，避免刷屏。

**Q：Web GUI 里任务跑完会通知吗？**
会。Web GUI 中每次任务（一次运行）结束对应根会话的 `turn/end`，与 CLI 行为一致。

**Q：`dsh plugin add` 报 peer 依赖错误？**
插件 peer 依赖 `@deepseek-ai/cordis@^4.0.1`，需要能从 npm 解析。若你的网络环境访问不了 npm registry，改用 `--offline` 或在 profile 里预先安装 cordis。

## 开发

```bash
pnpm install
pnpm run test        # vitest 单元测试（结果映射 / 平台命令 / spawn 回退）
pnpm run typecheck   # tsc --noEmit
pnpm run build       # tsc 产物到 lib/
```

源码结构：

```
src/index.ts    插件入口：name / Config 校验 / session/event 监听
src/notify.ts   结果映射、平台命令构建、detached spawn（含 Linux 回退）
src/types.ts    结构事件类型（零依赖，不依赖 dsh 内部包）
tests/          单元测试
```
