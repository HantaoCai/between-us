# 小程序账号与云开发（必做）

两人专属小程序需要你在微信侧完成注册；代码里已用占位 AppID，填上真实值即可预览/体验版。

## 1. 注册小程序

1. 打开 https://mp.weixin.qq.com/ → 立即注册 → 选 **小程序**
2. 主体优先 **个体户 / 企业**（个人主体类目与接口更窄；若只能个人，仍可做体验版给两人用）
3. 完成邮箱、信息登记后进入小程序后台
4. 首页复制 **AppID**

## 2. 开通云开发

1. 后台 → 云开发 → 开通（按提示创建环境）
2. 记下 **环境 ID**（形如 `between-us-xxxxx`）
3. 云数据库新建集合（权限先「仅创建者可读写」，上线前改为自定义安全规则）：
   - `wall_notes` — 拾光墙便签
   - `memories` — 回忆元数据
   - `couple` — 情侣绑定（openid ↔ her/me、固定房号）
   - `rooms` — 双人房状态
   - `room_events` — 房间消息（实时同步）
4. 云存储建目录约定：`photos/`

## 3. 填进工程

编辑本目录：

- `project.config.json` → `appid`
- `src/config/couple.ts` → `CLOUD_ENV_ID`
- （可选）`src/config/couple.ts` → `COUPLE_ROOM_CODE`（默认 `520131`）

## 4. 开发者工具

1. 安装 https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html
2. 导入目录：`apps/miniprogram`（或先在本目录 `npm install && npm run build:weapp`，再导入 `dist`）
3. 详情 → 本地设置 → 勾选「不校验合法域名…」（开发期）
4. 云开发控制台同步上传 `cloudfunctions/*`

## 5. 体验成员（她）

后台 → 管理 → 成员管理 → 添加 **体验成员**（她的微信号）  
上传体验版后，用体验版二维码即可，不必每次分享网页链接。
