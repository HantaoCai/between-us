# Between Us 微信小程序

Taro 4 + React + 微信云开发。两人专属：固定房号，打开即玩，不必每次分享链接。

## 你需要先做

完整步骤见 [SETUP_ACCOUNT.md](./SETUP_ACCOUNT.md)：

1. 注册小程序，拿到 **AppID**
2. 开通云开发，拿到 **环境 ID**
3. 填入 `project.config.json` 的 `appid` 与 `src/config/couple.ts` 的 `CLOUD_ENV_ID`
4. 把她加成体验成员

## 本机一键准备

```bash
export PATH="$HOME/.local/node/bin:$PATH"
cd apps/miniprogram
bash scripts/local-setup.sh
```

会装依赖、编译 `dist/`，并尽量打开微信开发者工具。  
**云数据库集合、上传云函数、设体验版** 必须在微信里点（见 `云开发点这里.md`）。

## 本地开发

```bash
cd apps/miniprogram
npm install
npm run build:weapp
# 或热更新
npm run dev:weapp
```

用微信开发者工具导入 **本目录**（`miniprogramRoot` 指向 `dist/`）。  
开发期勾选「不校验合法域名」。

## 云函数

在开发者工具「云开发」面板上传并部署：

- `bindIdentity` — 绑定 her/me
- `saveWall` — 保存拾光墙（仅情侣）
- `roomRelay` — 固定房 join/send
- `importSeed` — 导入种子 notes/memories

云数据库集合：`wall_notes`、`memories`、`couple`、`rooms`、`room_events`。

## 体验版发布

1. 开发者工具 → 上传
2. 小程序后台 → 管理 → 版本管理 → 选体验版
3. 生成体验版二维码发给她（或她在「我的小程序」里打开）

## 页面

- 拾光墙 / 里程碑 / 地方 / 印象 / 归档 / 回忆详情
- 编辑墙（钉文字/照片）
- 小游戏大厅（自动进 `COUPLE_ROOM_CODE`）
- 骰子、反应力、默契问答、猜数字、翻翻乐、化学反应、五子棋、德州、你画我猜

未配置云环境时：内容读本地 `src/data/*` 种子；房间为本地回环（可单机点 UI）。
