# between-us 线上编辑 API（Cloudflare Worker + R2）

为 GitHub Pages 静态站提供「钉照片 / 改墙」写接口。共享口令门禁，不必上账号体系。

## 准备

1. Cloudflare 账号，开通 **R2**
2. 创建桶，默认名 `between-us`（与 `wrangler.toml` 一致）
3. 本目录安装依赖：

```bash
cd cloudflare/edit-api
npm install
```

## 部署

```bash
npx wrangler login
npx wrangler deploy
npx wrangler secret put EDIT_PASSWORD
# 可选：限制浏览器来源（逗号分隔）
# npx wrangler secret put ALLOWED_ORIGINS
```

部署成功后记下 Worker URL，例如：

`https://between-us-edit-api.<subdomain>.workers.dev`

## 前端接线

仓库根目录或 GitHub Actions 设置：

```bash
VITE_EDIT_API=https://between-us-edit-api.<subdomain>.workers.dev
```

GitHub：Settings → Secrets and variables → Actions → **Variables** 增加 `VITE_EDIT_API`。

首次上线把仓库墙数据灌进 R2：

```bash
# 在仓库根目录
EDIT_API=https://... EDIT_PASSWORD='你的口令' npm run cloud:seed
```

之后可用 `npm run cloud:backup` 拉回 `src/data/notes.json` 与照片做冷备份。

## 接口

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/status` | 否 | `{ enabled, mode:'remote', needsPassword }` |
| POST | `/auth` | 是 | 校验口令 |
| GET | `/notes` | 否 | 墙数据；未 seed 返回 404 |
| PUT | `/notes` | 是 | 保存墙 |
| GET/PUT | `/photos` | GET 否 / PUT 是 | 照片元数据 |
| POST | `/upload` | 是 | multipart `file` |
| DELETE | `/photo` | 是 | `{ src }` |
| GET | `/files/...` | 否 | 读 R2 对象 |

鉴权头：`X-Edit-Password: <口令>` 或 `Authorization: Bearer <口令>`。
