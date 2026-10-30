# 回忆手帐

这里是 Between Us 的 Markdown 第二大脑：每一件事一篇文件。

## 怎么记

1. 复制 `_template.md`
2. 文件名建议：`YYYY-MM-DD-简短标题.md`
3. 填好 frontmatter（标题、日期、地点、心情、标签）
4. 正文随便写：对话、小事、想记住的一句话都可以

## Frontmatter 字段

| 字段 | 说明 |
|------|------|
| `title` | 标题 |
| `date` | `YYYY-MM-DD` |
| `place` | 地点（可空） |
| `mood` | 心情关键词 |
| `tags` | 标签数组 |
| `cover` | 可选封面图路径，如 `/photos/xxx.jpg` |

写完后本地 `npm run dev` 刷新即可在网页时间线里看到；推到 GitHub 并开启 Pages 后，对方也能打开浏览。
