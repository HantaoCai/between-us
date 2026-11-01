# Jev 代理（Cloudflare Worker）

把 TypeSafe API key 藏在 Worker Secret 里，前端只打本 Worker。

线上地址示例：

`https://dry-term-0bf5.davis121776003.workers.dev`

## 控制台粘贴

1. Worker 页 → **Edit code**
2. 用 `worker.js` 全文替换默认 Hello World
3. **Deploy** / Save and deploy
4. **Settings → Variables** 添加：
   - Secret：`TYPESAFE_API_KEY` = quant-lab 里那把 key
   - （可选）Secret：`PROXY_TOKEN` = 自定一串，前端请求头带 `X-Between-Us-Token`
   - （可选）明文：`TYPESAFE_MODEL` = `jev-latest`
   - （可选）明文：`ALLOWED_ORIGINS` = `http://127.0.0.1:43217,https://hantaocai.github.io`

## 自测

浏览器打开根路径应返回：

```json
{"ok":true,"service":"between-us-jev"}
```

本地：

```bash
curl -s https://dry-term-0bf5.davis121776003.workers.dev/jev \
  -H 'Content-Type: application/json' \
  -d '{"state":"hello","questions":{"x":{"type":"noul","instructions":"Is this a greeting?"}}}'
```

若设了 `PROXY_TOKEN`，再加：`-H 'X-Between-Us-Token: 你的token'`
