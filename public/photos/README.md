把你们的照片放在这个目录。

墙上显示用的是 `thumbs/` 里的小图（最长边约 360px），点开灯箱才加载原图。
本地 `npm run photos:thumbs` 可批量生成；`npm run dev` 上传时也会自动生成。

回忆 Markdown 的 frontmatter 可以写：

```yaml
cover: ./photos/示例.jpg
```

注意：推到公开 GitHub 仓库后，照片也会公开。私密内容请用私有仓库。
