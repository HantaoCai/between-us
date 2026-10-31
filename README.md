# between-us · Between Us

两个人的优点墙 + 小游戏。Markdown / 本地编辑存档，GitHub Pages 打开就能看。

仓库：[HantaoCai/between-us](https://github.com/HantaoCai/between-us)

线上：`https://hantaocai.github.io/between-us/`

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
- 照片放 `public/photos/`
- 墙数据在 `src/data/notes.json`
- GitHub Pages 线上只能看，不能改

在一起的天数起点：`src/lib/memories.ts` 里的 `TOGETHER_SINCE`。

## 小游戏

导航「小游戏」进入。双方打开同一个带房间号的链接即可进房（可做成二维码）：先到的人选身份并开房，后到的人自动是另一边，再选游戏开玩。

大厅按类型排列：升温 → 脑力 → 棋牌 → 合作 → 竞技。

| 类型 | 游戏 | 说明 |
|------|------|------|
| 升温 | 默契问答 | 同题各选，选一样算合拍；本地题库约 200 题，可开 6 / 8 / 10 题 |
| 脑力 | 猜数字 | 各想一个数，只算位置也正确的位数 |
| 脑力 | 答题对战 | 同题作答比分，可选题库分类 |
| 棋牌 | 简化德州 | 双人德州简化版 |
| 棋牌 | 五子棋 | 15 路对弈，可选黑棋禁手 |
| 合作 | 你画我猜 | 一人画一人猜，轮流加分 |
| 合作 | 翻翻乐 | 同一副牌轮流翻，一起配对清完 |
| 合作 | 掷骰子 | 各掷各的；可先不公开，重摇仍有动画 |
| 竞技 | 反应力 | 一起等绿灯，比谁点得更快，先到五分 |

## 发布说明

工作流：`.github/workflows/deploy.yml`。和 quant-dashboard 一样挂静态站，不需要阿里云电脑。

### 隐私

公开仓库谁都能看。亲密内容请用私有仓库；免费账号私有仓 Pages 可能不可用，那时本地 `npm run dev` / `npm run preview` 即可。

## 脚本

| 命令 | 作用 |
|------|------|
| `npm run dev` | 本地开发（可编辑） |
| `npm run build` | 构建到 `dist/` |
| `npm run preview` | 预览构建结果 |
