# between-us · Between Us

两个人的优点墙 + 小游戏。Markdown / 本地编辑存档，GitHub Pages 打开就能看。

仓库：[HantaoCai/between-us](https://github.com/HantaoCai/between-us)

线上（微信优先）：`https://hantao-jiajia.cn/`  
备用（GitHub Pages）：`https://hantaocai.github.io/between-us/`

## 怎么用（三步）

1. **写一条回忆**  
   复制 `memories/_template.md`，改成 `YYYY-MM-DD-标题.md`，填 frontmatter 和正文。

2. **本地看看**  
   `npm install && npm run dev`，浏览器打开本地地址（默认 `http://127.0.0.1:43217`）。

3. **推到 GitHub Pages**  
   仓库 Settings → Pages → Source 选 **GitHub Actions**。推送 `main` 后自动发布：  
   `https://你的用户名.github.io/仓库名/`

## 本地编辑

`npm run dev` 打开后会启用本地编辑（顶栏有提示）：

- 优点墙可钉贴纸 / 照片、拖动、改标签与标题（编辑后点外侧空白即保存）
- 照片在 **R2**（`/media/photos/…`），勿再把大图提交进 `public/photos/`
- 墙数据在 `src/data/notes.json`（线上以 R2 `data/notes.json` 为准）
- GitHub Pages 默认只读；点「编辑」输入与 Worker `PROXY_TOKEN` 相同的口令后可钉 / 取下

在一起的天数起点：`src/lib/memories.ts` 里的 `TOGETHER_SINCE`。

## 小游戏

导航「小游戏」进入。双方打开同一个带房间号的链接即可进房：先到的人选身份并开房，后到的人自动是另一边，再选游戏开玩。

| 类型 | 游戏 |
|------|------|
| 升温 | 默契问答（答自己 · 猜对方） |
| 脑力 | 猜数字、答题对战、你画你猜 |
| 棋牌 | 双人德州、五子棋 |
| 合作 | 你画我猜 |
| 对抗 | 翻翻乐 |
| 休闲 | 掷骰子 |
| 竞技 | 反应力 |

### 私密玩法（不在小游戏页）

小游戏链接会分享给别人，下列内容只挂在拾光侧标签：**清单 / 转盘**。

| 玩法 | 说明 |
|------|------|
| 愿望清单 | `/#/wishlist`，可增删勾选；编辑解锁后同步 R2 |
| 吃什么转盘 | `/#/eats`，可改选项；本机保存，解锁编辑可同步 |

### 人机与线上钉照片

同一 Cloudflare Worker（见 [`workers/cloud/`](workers/cloud/)）：

- **人机**：开房后「添加 AI 机器人」，可选猜数字、五子棋、德州、反应力等
- **钉照片**：图在 **R2** `photos/…`，墙在 `data/notes.json`，经 `/media/photos/…` 展示

配置示例见 [`.env.example`](.env.example)（复制为 `.env`，勿提交）。

1. Worker 贴最新 `worker.js` 并 Deploy；R2 Binding 名 `MEDIA`
2. Secret：`TYPESAFE_API_KEY`；**务必**配 `PROXY_TOKEN`（墙面编辑口令）
3. 旧图迁移（**先迁后删**）：
   - `npm run photos:r2:dry` 预览
   - `npm run photos:r2` 上传到 R2 并改引用（**不删**本地图）
   - 确认无误后 `npm run photos:r2 -- --purge` 删本地大图并提交

## 微信小程序

目录：[`apps/miniprogram/`](apps/miniprogram/)。Taro + 微信云开发，固定情侣房号。

1. 按 [`apps/miniprogram/SETUP_ACCOUNT.md`](apps/miniprogram/SETUP_ACCOUNT.md) 注册并开通云开发
2. `cd apps/miniprogram && npm install && npm run build:weapp`
3. 微信开发者工具导入该目录，上传体验版

## 发布说明

工作流：`.github/workflows/deploy.yml`（GitHub Pages + 可选 Cloudflare 同域挂站）。

自定义域挂前端：本机 `npm run deploy:cloud`（先 `wrangler login`），或给仓库加 Secrets  
`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 后推 `main` 自动部署。详见 [`workers/cloud/README.md`](workers/cloud/README.md)「0a」。

公开仓库谁都能看。亲密内容请用私有仓库；私有仓 Pages 不可用时，本地 `npm run dev` / `npm run preview` 即可。

## 脚本

| 命令 | 作用 |
|------|------|
| `npm run dev` | 本地开发（可编辑） |
| `npm run build` | 构建到 `dist/` |
| `npm run deploy:cloud` | 构建并部署到 `hantao-jiajia.cn`（Worker + 静态站） |
| `npm run preview` | 预览构建结果 |
