#!/usr/bin/env bash
# 在你的 Mac 上运行：把依赖装好、编出 dist，并打开说明。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v npm >/dev/null 2>&1; then
  echo "找不到 npm。请先安装 Node，或执行："
  echo "  export PATH=\"\$HOME/.local/node/bin:\$PATH\""
  exit 1
fi

echo "==> 安装依赖"
npm install

echo "==> 刷新种子数据"
npm run seed

echo "==> 编译微信小程序 (dist/)"
npm run build:weapp

echo
echo "=========================================="
echo " 本机自动部分已完成。请继续手动 3 步："
echo "=========================================="
echo
echo "1) 打开「微信开发者工具」"
echo "   - 导入项目目录："
echo "     $ROOT"
echo "   - AppID 用：wx47bde352ad9b3c36"
echo
echo "2) 云开发控制台（工具顶部「云开发」）"
echo "   环境：capable-porcupine-d1ddjw55abb0c2"
echo "   建集合：wall_notes / memories / couple / rooms / room_events"
echo "   上传并部署云函数目录 cloudfunctions/ 下全部函数"
echo
echo "3) 预览 / 上传 → 设为体验版；后台把她加成体验成员"
echo
echo "详细说明：$ROOT/SETUP_ACCOUNT.md"
echo

# macOS 尝试唤起开发者工具（若已安装）
if [[ "$(uname)" == "Darwin" ]]; then
  open -a "微信开发者工具" "$ROOT" 2>/dev/null || \
  open -a "wechatwebdevtools" "$ROOT" 2>/dev/null || \
  true
fi
