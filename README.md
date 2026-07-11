# Voice Live

类似 ChatGPT 语音模式（ChatGPT Live）的 Web 应用，支持可插拔的多 LLM 实时语音后端。
MVP 已接入 **OpenAI Realtime API**（即 ChatGPT 语音模式背后的接口），默认模型
`gpt-realtime-2.1`。

> 说明：GPT‑5.6（Sol/Terra/Luna）是文本模型系列，OpenAI 的实时语音走的是独立的
> GPT‑Realtime 模型线；ChatGPT 语音模式当前对应的最新模型即 `gpt-realtime-2.1`。

## 功能

- 实时语音对话：浏览器通过 WebRTC 直连 OpenAI，延迟最低，API key 不进浏览器
- 实时字幕：你说的话（输入转写）和 AI 的回答逐字显示
- 通话中可静音、可打字补充发言
- 可切换模型（gpt-realtime-2.1 / 2.1-mini / 2 / gpt-realtime）、声音（marin、cedar 等 10 种）、自定义系统指令
- 多后端架构：实现 `LiveClient` 接口并注册即可接入新后端（如 Gemini Live）

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置 API key（二选一）
#    a) 复制 .env.example 为 .env，填入 OPENAI_API_KEY（推荐）
#    b) 不配置，启动后在页面左侧设置里粘贴 key
cp .env.example .env

# 3. 启动（token 服务 :8787 + 前端 :5173）
npm run dev
```

打开 http://localhost:5173 ，点击"开始通话"，授权麦克风后直接说话即可。

生产部署：`npm run build && npm start`（Express 同时托管静态文件和 token 服务）。

## 架构

```
浏览器 ──(1) POST /api/openai/client-secret──▶ Express (server/index.mjs)
   │                                              │ 用 OPENAI_API_KEY 调
   │                                              ▼ POST /v1/realtime/client_secrets
   │◀──── 临时密钥 ek_... ────────────────────  OpenAI
   │
   └─(2) WebRTC (SDP → /v1/realtime/calls, 音频双向 + "oai-events" 数据通道)──▶ OpenAI
```

- `server/index.mjs` — 唯一的服务端：换取临时密钥（真实 key 不出服务器）
- `src/lib/live/types.ts` — 后端无关的 `LiveClient` / `LiveProvider` 抽象
- `src/lib/live/providers/openai.ts` — OpenAI Realtime 的 WebRTC 实现
- `src/lib/live/registry.ts` — 后端注册表（新后端在这里加一行）
- `src/App.tsx` + `src/components/` — 通话 UI（发光球、字幕、设置）

## 接入新的 live 后端

1. 在 `src/lib/live/providers/<name>.ts` 中实现 `LiveClient`
   （connect / disconnect / setMuted / sendText / 音频流 / transcript 事件）
2. 导出一个 `LiveProvider`（id、模型列表、声音列表、`createClient`）
3. 在 `src/lib/live/registry.ts` 的 `providers` 数组中注册
4. 如需服务端换 token，在 `server/index.mjs` 加对应端点

## 环境变量（.env）

| 变量 | 说明 |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI API key（必需，除非在页面里填） |
| `OPENAI_BASE_URL` | 自定义 API 地址，默认 `https://api.openai.com` |
| `TOKEN_SERVER_PORT` | token 服务端口，默认 8787（需与 vite 代理一致） |
