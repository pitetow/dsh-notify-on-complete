#!/usr/bin/env bash
# =============================================================================
# Copyright (c) 2026 Luozy
# SPDX-License-Identifier: MIT
#
# dsh-notify-on-complete 一键安装脚本（GitHub 源码分发，无需 npm 发布）
#
# 流程：下载源码 → 构建 → `dsh plugin add link:` → CLI 识别包内
# `dsh.bundle.patch`（cordis.patch.yml）自动注册 bundle → 下次启动自动挂载。
# 全程不需要手动编辑任何配置文件。所有步骤幂等，可安全重复执行。
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/pitetow/dsh-notify-on-complete/main/scripts/install.sh | bash
#   curl -fsSL <同上> | bash -s -- --profile headless   # 指定 profile（默认 web）
#   curl -fsSL <同上> | bash -s -- --force              # 强制重新下载源码（更新）
#
# 环境变量（可省略）：
#   DSH_PROFILE     默认 web
#   DSH_PLUGIN_DIR  默认 ~/.dsh/plugins/dsh-notify-on-complete
# =============================================================================
set -euo pipefail

REPO="pitetow/dsh-notify-on-complete"
BRANCH="main"
PKG="dsh-notify-on-complete"
PROFILE="${DSH_PROFILE:-web}"
PLUGIN_DIR="${DSH_PLUGIN_DIR:-${HOME:-${USERPROFILE:-}}/.dsh/plugins/dsh-notify-on-complete}"
PROFILE_DIR="${HOME:-${USERPROFILE:-}}/.dsh/profiles/$PROFILE"
PATCH_YML="$PROFILE_DIR/cordis.patch.yml"

say()  { printf '\033[32m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

FORCE=false
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=true ;;
    -h|--help) echo "用法：bash scripts/install.sh [--profile <名>] [--force]"; exit 0 ;;
    --profile) shift; [ $# -ge 1 ] || die "--profile 需要跟一个 profile 名（或用环境变量 DSH_PROFILE）"; PROFILE="$1" ;;
    --profile=*) PROFILE="${1#--profile=}" ;;
    *) die "未知参数: $1（用 -h 查看帮助）" ;;
  esac
  shift
done

# 前置校验
command -v node >/dev/null 2>&1 || die "未找到 node（需要 Node.js ^22），请先安装并加入 PATH。"
command -v pnpm >/dev/null 2>&1 || die "未找到 pnpm，请先安装：npm i -g pnpm"
command -v dsh  >/dev/null 2>&1 || die "未找到 dsh，请先安装 DeepSeek Harness CLI。"
[ -d "$PROFILE_DIR" ] || die "找不到 profile 目录：$PROFILE_DIR（请先运行过一次 dsh）"

# 步骤 1：获取源码
if [ -d "$PLUGIN_DIR" ] && [ "$FORCE" = false ]; then
  say "源码已存在：$PLUGIN_DIR（--force 重新下载，或 cd 进去 git pull 更新）"
else
  say "下载源码 https://github.com/$REPO (branch: $BRANCH) ..."
  TMP="$(mktemp -d)"
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" -o "$TMP/src.tgz" \
    || die "下载失败（网络问题？仓库地址变更？）"
  rm -rf "$PLUGIN_DIR"
  mkdir -p "$PLUGIN_DIR"
  tar -xzf "$TMP/src.tgz" -C "$TMP"
  mv "$TMP/$PKG-$BRANCH/"* "$PLUGIN_DIR/"
  rm -rf "$TMP"
fi

# 步骤 2：安装依赖并构建
say "构建 $PKG ..."
(cd "$PLUGIN_DIR" && pnpm install && pnpm run build)

# 步骤 3：link 安装（CLI 读到 dsh.bundle.patch 自动注册 bundle）
say "dsh plugin --profile $PROFILE add link:$PLUGIN_DIR ..."
dsh plugin --profile "$PROFILE" add "link:$PLUGIN_DIR"

# 步骤 4：校验 bundle 已注册（挂载生效的判据）
if ! node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const bundles = p.dsh?.profile?.bundles ?? [];
  process.exit(bundles.includes(process.argv[2]) ? 0 : 1);
' "$PROFILE_DIR/package.json" "$PKG"; then
  warn "$PKG 未出现在 dsh.profile.bundles 中——自动挂载未注册。"
  warn "请检查 $PLUGIN_DIR/package.json 的 dsh.bundle 声明是否完整，或重跑本脚本。"
  exit 1
fi
say "bundle 已注册：dsh.profile.bundles 包含 $PKG（下次启动自动挂载）"

# 步骤 5：幂等移除旧手动挂载行（避免双挂载；移除后若文件为空补 []）
MOUNT_RESULT="$(node -e '
const fs = require("fs");
const p = process.argv[1];
const lines = fs.readFileSync(p, "utf8").split("\n");
const out = [];
let i = 0;
let removed = false;
while (i < lines.length) {
  const line = lines[i];
  if (/^[ \t]*- insert:\s*$/.test(line)) {
    const block = [line];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== "" && !/^-\s/.test(lines[j])) {
      block.push(lines[j]);
      j++;
    }
    if (block.some((l) => /id:\s*notify-on-complete\b/.test(l))) {
      while (out.length && /^[ \t]*#/.test(out[out.length - 1])) out.pop();
      i = j;
      removed = true;
      continue;
    }
  }
  out.push(line);
  i++;
}
if (!removed) {
  console.log("none");
} else {
  let t = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (t === "" || !/^[-[]/.test(t)) t += (t ? "\n\n" : "") + "[]";
  fs.writeFileSync(p, t + "\n");
  console.log("removed");
}
' "$PATCH_YML")"
[ "$MOUNT_RESULT" = "removed" ] \
  && say "已从 $PATCH_YML 移除旧的 $PKG 手动挂载行（bundle 通道接管挂载）" \
  || say "无旧手动挂载行，跳过"

say "安装完成：$PKG (profile: $PROFILE)。重启 dsh 后生效——CLI 一次性运行下次自然生效；web 需重启 dsh web 进程。"
