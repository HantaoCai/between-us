# Between Us · Cloudflare Worker

同一个 Worker 承担：

| 路径 | 作用 |
|------|------|
| `POST /jev` | 代理 TypeSafe Jev（人机五子棋） |
| `GET/PUT /edit/notes` | 墙面便签（存在 R2） |
| `POST /edit/upload` | 钉照片上传到 R2 |
| `DELETE /edit/photo` | 删 R2 照片 |
| `GET /media/photos/...` | 公开读图 |
| `POST /stats/view` | 拾光页浏览上报（公开） |
| `GET /stats` | 读拾光 PV / UV（公开，不含 visitorId） |
| `GET /peer/room/:code` | **WebSocket 双人房中继**（Durable Object，替代 PeerJS） |

**上传的图放哪：** Cloudflare **R2**，前缀分目录：

- 新钉：`photos/时间戳-名字.jpg`
- 迁移旧图：`photos/原文件名`（可带 `photos/thumbs/…`）
- 墙数据：`data/notes.json`

公开读：`https://你的Worker/media/photos/…`

**从 GitHub 撤图：** 先 `npm run photos:r2` 迁完并打开 Pages 确认墙面正常，再 `--purge` / 从仓库删大图。未验证前不要删。

线上地址：`https://hantao-jiajia.cn`（自定义域名，绕开 `workers.dev` 被墙）  
备用：`https://dry-term-0bf5.davis121776003.workers.dev`

---

## 0. 自定义域名（外网中继，必做）

域名在腾讯云注册、DNS 若仍是 DNSPod，需要接到 Cloudflare 才能绑 Worker：

1. [Cloudflare](https://dash.cloudflare.com) → **Add a site** → 填 `hantao-jiajia.cn`
2. 选 Free 计划，记下 Cloudflare 给的 **两个 NS**（形如 `xxx.ns.cloudflare.com`）
3. 腾讯云域名控制台 → 该域名 → **修改 DNS 服务器** → 改成 Cloudflare 那两个 NS（不要继续用 DNSPod）
4. 等 NS 生效（几分钟到几小时；`.cn` 若还在「命名审核中」需等审核过了再改）
5. NS 生效后，二选一绑域名：
   - Dashboard：Worker `dry-term-0bf5` → **Settings** → **Domains & Routes** → **Add** → Custom Domain → `hantao-jiajia.cn`
   - 或取消 `wrangler.toml` 里 `routes` 注释后再：

```bash
cd workers/jev-proxy
npx wrangler deploy
```

验证：

```bash
curl -s https://hantao-jiajia.cn/ | head
```

应出现 `"peer": true`。前端默认 `VITE_JEV_PROXY_URL=https://hantao-jiajia.cn`。

## 1. 贴代码

Worker → **Edit code** → 用本目录 `worker.js` 全文替换 → **Deploy**

## 2. 建 R2 桶（钉照片必做）

1. 左侧 **R2 Object Storage** → **Create bucket**
2. 名字例如：`between-us-media`
3. 回到 Worker → **Settings** → **Bindings** → **Add** → **R2 bucket**
   - Variable name：`MEDIA`（必须叫这个）
   - R2 bucket：选刚建的桶
4. 保存 / 重新 Deploy

## 2b. 双人房中继（Durable Object，必做）

用本目录 `wrangler.toml` 部署（会绑 `ROOMS` → `RoomBroker`）：

```bash
cd workers/jev-proxy
npx wrangler deploy
```

健康检查应出现 `"peer": true`：

```bash
curl -s https://hantao-jiajia.cn/ | head
```

前端默认走这条 WebSocket 中继（不再依赖 PeerJS 云信令）。若要强制旧 WebRTC：`.env` 设 `VITE_PEER_TRANSPORT=webrtc`。

## 3. Secrets / Variables

| 类型 | 名字 | 说明 |
|------|------|------|
| Secret | `TYPESAFE_API_KEY` | Jev 用（与 quant-lab 同一把） |
| Secret | `PROXY_TOKEN` | **强烈建议**；前端请求头 `X-Between-Us-Token` |
| 明文 | `TYPESAFE_MODEL` | 可选，`jev-latest` |
| 明文 | `ALLOWED_ORIGINS` | 可选，`http://127.0.0.1:43217,https://hantaocai.github.io` |

## 4. 前端

`.env` / 代码默认里的 `VITE_JEV_PROXY_URL` 指向本 Worker。  
若设了 `PROXY_TOKEN`，同步设 `VITE_JEV_PROXY_TOKEN`（会打进前端包，只作轻门闩）。

## 5. 自测

```bash
# 健康检查（应含 "edit": true）
curl -s https://hantao-jiajia.cn/

# 编辑开关
curl -s https://hantao-jiajia.cn/edit/status

# 拾光浏览量（部署含 /stats 的 Worker 后）
curl -s https://hantao-jiajia.cn/stats
```

手机打开 GitHub Pages → 应出现钉照片；第一张图写入 R2 后，刷新两边都能看到。
