照片已迁到 Cloudflare R2，经 Worker `/media/photos/…` 公开读取。

本地不要再往这个目录塞大图进仓库。钉照片请走线上/编辑接口（写入 R2），或：

```bash
npm run photos:r2        # 若还有本地残留，上传并改引用
# 确认墙面正常后再：
npm run photos:r2 -- --purge
```

回忆 Markdown 的封面请写完整 media URL，例如：

```yaml
cover: https://hantao-jiajia.cn/media/photos/示例.jpg
```
