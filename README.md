# Voice Live

English | [中文](README.zh-CN.md)

A web app similar to ChatGPT's voice mode (ChatGPT Live), with a pluggable
architecture for multiple realtime LLM voice backends. Ships with three
backends: the **OpenAI Realtime API** (the engine behind ChatGPT voice,
default model `gpt-realtime-2.1`), the **xAI Grok Voice Agent API**
(`grok-voice-latest`), and the **Google Gemini Live API**
(`gemini-3.1-flash-live-preview`).

> Note: GPT‑5.6 (Sol/Terra/Luna) is the text model family; OpenAI's realtime
> voice runs on the separate GPT‑Realtime model line. The latest model behind
> ChatGPT voice mode is `gpt-realtime-2.1`.

## Features

- Realtime voice conversation: the browser connects directly to the backend
  (WebRTC for OpenAI, WebSocket + PCM streaming for Grok) for minimal
  latency; API keys never reach the browser — the token service mints
  short-lived ephemeral secrets for both backends
- Live captions: your speech (input transcription) and the AI's reply are
  rendered word by word
- Mute and type-to-talk during a call
- Two model tiers (flagship `gpt-realtime-2.1` / faster & cheaper `-mini`),
  10 voices (marin, cedar, …), custom system instructions
- Click a voice to preview it (plays pre-generated MP3s from
  `public/voice-previews/`; run `npm run gen-previews` after adding voices)
- Multi-backend architecture: implement the `LiveClient` interface and
  register it to add a new backend (e.g. Gemini Live)
- Bilingual UI (English / 中文): defaults to the browser language, switchable
  from the header; the choice is remembered in `localStorage`
- Optional login gate: can require a valid session from a co-hosted app
  (e.g. LibreChat) before serving the app (see
  [Login gate](#login-gate-reusing-another-apps-session); off by default)

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure the API key (either option)
#    a) Copy .env.example to .env and set OPENAI_API_KEY (recommended)
#    b) Skip it and paste a key in the in-page settings panel after launch
cp .env.example .env

# 3. Start (token service on :8787 + frontend on :5173)
npm run dev
```

Open http://localhost:5173, click "Start call", grant microphone access, and
just talk.

Production: `npm run build && npm start` (Express serves both the static
build and the token service), or use the included [Dockerfile](Dockerfile).

## Configuration

All runtime settings are environment variables (loaded from `.env` in the
project root, which overrides inherited shell variables). See
[.env.example](.env.example).

| Variable | Default | Description |
| --- | --- | --- |
| `OPENAI_API_KEY` | — | OpenAI API key. Required unless users paste their own key in the page settings. |
| `OPENAI_BASE_URL` | `https://api.openai.com` | Custom OpenAI-compatible API base URL. |
| `XAI_API_KEY` | — | xAI API key; required for the Grok Voice Agent backend. |
| `XAI_BASE_URL` | `https://api.x.ai` | Custom xAI API base URL. |
| `GEMINI_API_KEY` | — | Google API key ([aistudio.google.com/apikey](https://aistudio.google.com/apikey)); required for the Gemini Live backend. |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com` | Custom Gemini API base URL. |
| `TOKEN_SERVER_PORT` | `8787` | Port for the Express token service. Must match the `/api` proxy target in `vite.config.ts` during development. |
| `BASE_PATH` | `/` (root) | URL sub-path the server mounts everything under, e.g. `/voice` when deployed behind a reverse proxy at `https://example.com/voice/`. Pair with the `VITE_BASE_PATH` build arg below. |
| `REQUIRE_AUTH` | `false` | Set to `true` to require a valid login for every request except `/api/health`. When enabled, `AUTH_JWT_SECRET` must also be set or the server refuses to start. |
| `AUTH_JWT_SECRET` | — | JWT signing secret of the app whose login cookie is verified (for LibreChat, copy `JWT_REFRESH_SECRET` from its `.env`). |
| `AUTH_COOKIE_NAME` | `refreshToken` | Name of the session cookie to verify. The default matches LibreChat's cookie. |
| `LOGIN_REDIRECT_URL` | `/login` | Where browsers without a valid login are redirected. Non-browser requests get `401` JSON instead. |

Build-time setting (Vite):

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_BASE_PATH` | `/` | Public base path baked into the frontend build (asset URLs and same-origin API calls). Set to `/voice/` when serving under a sub-path; passed as a build arg in the [Dockerfile](Dockerfile). |

## Architecture

```
Browser ──(1) POST /api/openai/client-secret──▶ Express (server/index.mjs)
   │                                              │ uses OPENAI_API_KEY to call
   │                                              ▼ POST /v1/realtime/client_secrets
   │◀──── ephemeral key ek_... ────────────────  OpenAI
   │
   └─(2) WebRTC (SDP → /v1/realtime/calls, bidirectional audio + "oai-events" data channel)──▶ OpenAI
```

- `server/index.mjs` — the only server piece: mints ephemeral keys (the real
  key never leaves the server) and optionally enforces the LibreChat login gate
- `src/lib/live/types.ts` — backend-agnostic `LiveClient` / `LiveProvider`
  abstractions
- `src/lib/live/providers/openai.ts` — WebRTC implementation for OpenAI Realtime
- `src/lib/live/registry.ts` — backend registry (add new backends here)
- `src/lib/base.ts` — `withBase()` helper; all same-origin URLs go through it
  so the app works under a sub-path
- `src/App.tsx` + `src/components/` — call UI (glowing orb, captions, settings)

## Login gate (reusing another app's session)

Voice Live can piggyback on the login of any app deployed on the **same
domain** that issues an HMAC-signed JWT session cookie — **without modifying
that app at all**. This is opt-in and disabled by default.

How it works: when a user logs into the host app, it sets an httpOnly JWT
cookie. If Voice Live is served from the same domain (as a sub-path, e.g.
`https://chat.example.com/voice/`), the browser sends that cookie along
automatically. With `REQUIRE_AUTH=true`, the Express server verifies the
cookie's signature with the shared secret (`AUTH_JWT_SECRET`): valid sessions
pass through, everyone else is redirected to the login page (or gets a `401`
for API calls). The key-minting endpoint is behind the same gate, so only
logged-in users can spend your OpenAI quota.

[LibreChat](https://github.com/danny-avila/LibreChat) is the worked example
(and the source of the defaults): it sets a `refreshToken` cookie signed with
the `JWT_REFRESH_SECRET` from its `.env`. For a different host app, point
`AUTH_COOKIE_NAME` at its session cookie and `AUTH_JWT_SECRET` at its signing
secret.

Example service for a LibreChat `docker-compose.yml` that uses
[nginx-proxy](https://github.com/nginx-proxy/nginx-proxy) (path-based routing
via `VIRTUAL_PATH`):

```yaml
  voice-live:
    build:
      context: ./voice-live
      args:
        - VITE_BASE_PATH=/voice/
    restart: always
    environment:
      - VIRTUAL_HOST=chat.example.com     # same host as LibreChat
      - VIRTUAL_PATH=/voice
      - VIRTUAL_PORT=8787
      - BASE_PATH=/voice
      - REQUIRE_AUTH=true
      - AUTH_JWT_SECRET=${JWT_REFRESH_SECRET}   # from LibreChat's .env
      - LOGIN_REDIRECT_URL=https://chat.example.com/login
      - OPENAI_API_KEY=${OPENAI_API_KEY:-}
```

Known limits: the gate verifies that the cookie is a genuine, unexpired
token (for LibreChat the default lifetime is 7 days). It does not query the
host app's session store, so logging out there does not instantly revoke
access for a captured cookie until it expires. Sub-domain deployments do not
work when the host app's cookie is host-only (LibreChat's is), so Voice Live
must live on the same host.

## Adding a new live backend

1. Implement `LiveClient` in `src/lib/live/providers/<name>.ts`
   (connect / disconnect / setMuted / sendText / audio streams / transcript
   events)
2. Export a `LiveProvider` (id, model list, voice list, `createClient`)
3. Register it in the `providers` array in `src/lib/live/registry.ts`
4. If the backend needs a server-side token exchange, add an endpoint in
   `server/index.mjs`
