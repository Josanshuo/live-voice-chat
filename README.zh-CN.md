# Voice Live

[English](README.md) | 中文

类似 ChatGPT 语音模式（ChatGPT Live）的 Web 应用，支持可插拔的多 LLM 实时语音
后端。已接入两个后端：**OpenAI Realtime API**（ChatGPT 语音同款，默认模型
`gpt-realtime-2.1`）和 **xAI Grok Voice Agent API**（`grok-voice-latest`，
Eve/Ara/Rex/Sal/Leo 五种声音）。

> 说明：GPT‑5.6（Sol/Terra/Luna）是文本模型系列，OpenAI 的实时语音走的是独立的
> GPT‑Realtime 模型线；ChatGPT 语音模式当前对应的最新模型即 `gpt-realtime-2.1`。

## 功能

- 实时语音对话：浏览器直连各家后端（OpenAI 走 WebRTC，Grok 走 WebSocket + PCM
  流），延迟最低；API key 不进浏览器，token 服务为两家后端统一换发短时临时密钥
- 实时字幕：你说的话（输入转写）和 AI 的回答逐字显示
- 通话中可静音、可打字补充发言
- 模型两档可选（旗舰版 `gpt-realtime-2.1` / 高速省钱版 `-mini`）、声音 10 种
  （marin、cedar 等）、自定义系统指令
- 点击声音即可试听（播放 `public/voice-previews/` 下预生成的 MP3；新增声音后
  运行 `npm run gen-previews` 重新生成）
- 多后端架构：实现 `LiveClient` 接口并注册即可接入新后端（如 Gemini Live）
- 双语界面（English / 中文）：默认跟随浏览器语言，页面顶部可切换，选择会记住
  在 `localStorage`
- 可选登录门槛：可要求先登录同域部署的其他应用（如 LibreChat）才能使用（见
  [登录门槛](#登录门槛复用其他应用的登录态)；默认关闭）

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置 API key（二选一）
#    a) 复制 .env.example 为 .env，填入 OPENAI_API_KEY（推荐）
#    b) 不配置，启动后在页面设置里粘贴 key
cp .env.example .env

# 3. 启动（token 服务 :8787 + 前端 :5173）
npm run dev
```

打开 http://localhost:5173 ，点击"开始通话"，授权麦克风后直接说话即可。

生产部署：`npm run build && npm start`（Express 同时托管静态文件和 token
服务），或使用自带的 [Dockerfile](Dockerfile)。

## 配置

所有运行时配置都是环境变量（从项目根目录的 `.env` 加载，并覆盖继承自 shell 的
同名变量），参见 [.env.example](.env.example)。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `OPENAI_API_KEY` | — | OpenAI API key。除非用户在页面设置里自填 key，否则必需。 |
| `OPENAI_BASE_URL` | `https://api.openai.com` | 自定义 OpenAI 兼容 API 地址。 |
| `XAI_API_KEY` | — | xAI API key，启用 Grok Voice Agent 后端时必需。 |
| `XAI_BASE_URL` | `https://api.x.ai` | 自定义 xAI API 地址。 |
| `TOKEN_SERVER_PORT` | `8787` | Express token 服务端口。开发时需与 `vite.config.ts` 中 `/api` 代理目标一致。 |
| `BASE_PATH` | `/`（根路径） | 服务端挂载的 URL 子路径，例如部署在 `https://example.com/voice/` 反代之后时设为 `/voice`。需与下方 `VITE_BASE_PATH` 构建参数配套。 |
| `REQUIRE_AUTH` | `false` | 设为 `true` 时，除 `/api/health` 外的所有请求都要求有效登录。启用时必须同时设置 `AUTH_JWT_SECRET`，否则服务端拒绝启动。 |
| `AUTH_JWT_SECRET` | — | 被验签应用的 JWT 签名密钥（对 LibreChat 来说，就是其 `.env` 中的 `JWT_REFRESH_SECRET`）。 |
| `AUTH_COOKIE_NAME` | `refreshToken` | 要验签的会话 cookie 名，默认值与 LibreChat 一致。 |
| `LOGIN_REDIRECT_URL` | `/login` | 未登录的浏览器请求重定向到哪里；非浏览器请求返回 `401` JSON。 |

构建期配置（Vite）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_BASE_PATH` | `/` | 打进前端构建产物的公共路径（静态资源与同源 API 调用）。部署在子路径下时设为 `/voice/`；[Dockerfile](Dockerfile) 中作为构建参数传入。 |

## 架构

```
浏览器 ──(1) POST /api/openai/client-secret──▶ Express (server/index.mjs)
   │                                              │ 用 OPENAI_API_KEY 调
   │                                              ▼ POST /v1/realtime/client_secrets
   │◀──── 临时密钥 ek_... ────────────────────  OpenAI
   │
   └─(2) WebRTC (SDP → /v1/realtime/calls, 双向音频 + "oai-events" 数据通道)──▶ OpenAI
```

- `server/index.mjs` — 唯一的服务端：换取临时密钥（真实 key 不出服务器），
  并可选启用登录门槛
- `src/lib/live/types.ts` — 后端无关的 `LiveClient` / `LiveProvider` 抽象
- `src/lib/live/providers/openai.ts` — OpenAI Realtime 的 WebRTC 实现
- `src/lib/live/registry.ts` — 后端注册表（新后端在这里加一行）
- `src/lib/base.ts` — `withBase()` 辅助函数；所有同源 URL 都经过它，保证
  子路径部署可用
- `src/lib/i18n.ts` — 轻量双语文案表（English / 中文），无第三方依赖
- `src/App.tsx` + `src/components/` — 通话 UI（发光球、字幕、设置）

## 登录门槛（复用其他应用的登录态）

Voice Live 可以搭载**同域名**下任何签发 HMAC 签名 JWT 会话 cookie 的应用的
登录态——**完全不需要改动对方应用**。此功能默认关闭，需显式开启。

原理：用户登录宿主应用后，对方会种一个 httpOnly 的 JWT cookie。只要 Voice
Live 部署在同一域名（子路径形式，如 `https://chat.example.com/voice/`），
浏览器就会自动带上这个 cookie。设置 `REQUIRE_AUTH=true` 后，Express 服务端用
共享密钥（`AUTH_JWT_SECRET`）验证 cookie 签名：有效会话放行，其余浏览器请求
重定向到登录页（API 请求返回 `401`）。发临时密钥的接口也在门槛之内，因此只有
已登录用户才能消耗你的 OpenAI 配额。

[LibreChat](https://github.com/danny-avila/LibreChat) 是现成的范例（默认值
也来自它）：它会种一个用其 `.env` 中 `JWT_REFRESH_SECRET` 签名的
`refreshToken` cookie。换成别的宿主应用时，把 `AUTH_COOKIE_NAME` 指向它的
会话 cookie、`AUTH_JWT_SECRET` 指向它的签名密钥即可。

配合 [nginx-proxy](https://github.com/nginx-proxy/nginx-proxy)（`VIRTUAL_PATH`
路径路由）的 LibreChat `docker-compose.yml` 服务示例：

```yaml
  voice-live:
    build:
      context: ./voice-live
      args:
        - VITE_BASE_PATH=/voice/
    restart: always
    environment:
      - VIRTUAL_HOST=chat.example.com     # 与 LibreChat 同域名
      - VIRTUAL_PATH=/voice
      - VIRTUAL_PORT=8787
      - BASE_PATH=/voice
      - REQUIRE_AUTH=true
      - AUTH_JWT_SECRET=${JWT_REFRESH_SECRET}   # 来自 LibreChat 的 .env
      - LOGIN_REDIRECT_URL=https://chat.example.com/login
      - OPENAI_API_KEY=${OPENAI_API_KEY:-}
```

已知边界：门槛只验证 cookie 是真实、未过期的 token（LibreChat 默认有效期
7 天），不查询宿主应用的会话存储，因此在对方那里退出登录后，被截获的 cookie
在过期前仍可通过验证。子域名部署不可行——宿主应用的 cookie 若是 host-only
（LibreChat 即如此），Voice Live 必须与它在同一主机名下。

## 接入新的 live 后端

1. 在 `src/lib/live/providers/<name>.ts` 中实现 `LiveClient`
   （connect / disconnect / setMuted / sendText / 音频流 / transcript 事件）
2. 导出一个 `LiveProvider`（id、模型列表、声音列表、`createClient`）
3. 在 `src/lib/live/registry.ts` 的 `providers` 数组中注册
4. 如需服务端换 token，在 `server/index.mjs` 加对应端点
