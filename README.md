# between-us · 双人记

用 Git 记下两个人之间的事：Markdown 手帐 + 可浏览的网页时间线。

仓库：[HantaoCai/between-us](https://github.com/HantaoCai/between-us)

预览方式和 [quant-dashboard](https://github.com/HantaoCai/quant-dashboard) 一样——**开 GitHub Pages 后，打开链接就能看**，不需要阿里云电脑托管。预计地址：

`https://hantaocai.github.io/between-us/`

## 本地运行

```bash
npm install
npm run dev
```

浏览器打开终端里提示的地址（默认 `http://127.0.0.1:43217`）。

## 写一条回忆

1. 复制 `memories/_template.md`
2. 改名为 `YYYY-MM-DD-简短标题.md`
3. 填标题、日期、地点、心情、标签和正文
4. 刷新本地页面，时间线会自动出现

把照片放进 `public/photos/`，需要的话在 frontmatter 里写 `cover: ./photos/xxx.jpg`。

在一起的天数起点：编辑 `src/lib/memories.ts` 里的 `TOGETHER_SINCE`。

## 发布到 GitHub Pages（推荐）

1. 在 GitHub 创建仓库并推送本项目
2. 打开 **Settings → Pages → Build and deployment**
3. **Source** 选 **GitHub Actions**
4. 推送到 `main` 后，工作流 `.github/workflows/deploy.yml` 会自动构建并发布
5. 访问：`https://你的用户名.github.io/仓库名/`

和 quant-dashboard 的差别只是：那边是手写静态 HTML；这里用 Vite 构建，但最终同样是静态站点挂在 Pages 上。

### 隐私提醒

公开仓库谁都能看。亲密内容请用**私有仓库**。免费账号私有仓的 Pages 可能不可用，那时用 `npm run dev` / `npm run build && npm run preview` 本地看即可。

## 其他建议

| 想法 | 怎么做 |
|------|--------|
| Markdown 第二大脑 | 只维护 `memories/`，Git 自动留历史 |
| 照片墙 | `public/photos/` + 回忆里的 `cover` |
| U 盘博物馆 | 定期拷贝 `memories/`、`public/photos/`、`dist/` |
| 纪念日倒数 | 改 `TOGETHER_SINCE` |
| 阿里云电脑 | **一般不必**；只有要 24 小时私有服务、内网穿透或跑后端时才需要 |

## 脚本

| 命令 | 作用 |
|------|------|
| `npm run dev` | 本地开发 |
| `npm run build` | 构建到 `dist/` |
| `npm run preview` | 预览构建结果 |
