import dotenv from "dotenv";
import express from "express";
import jwt from "jsonwebtoken";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// override: true so the project .env wins over any stale OPENAI_API_KEY
// lingering in the machine-wide environment.
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

const app = express();
app.use(express.json());

// Deliberately not process.env.PORT: dev harnesses use PORT for the Vite
// dev server, and this token service must stay on the port the Vite proxy
// points at.
const PORT = process.env.TOKEN_SERVER_PORT || 8787;
const OPENAI_BASE = process.env.OPENAI_BASE_URL || "https://api.openai.com";

// When deployed behind LibreChat's nginx the app lives under /voice; nginx
// passes the prefix through unchanged, so mount everything under BASE_PATH.
const BASE_PATH = (process.env.BASE_PATH || "").replace(/\/+$/, "");

// Optional login gate, off by default (REQUIRE_AUTH=true to enable). When
// on, we piggyback on another app's existing session: any app served from
// the same origin that issues an HMAC-signed JWT cookie works (for
// LibreChat, that's the "refreshToken" cookie signed with its
// JWT_REFRESH_SECRET). The browser sends the cookie here automatically; we
// only verify what the other app already issued and never modify it.
const AUTH_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.REQUIRE_AUTH || "").toLowerCase(),
);
const AUTH_SECRET = process.env.AUTH_JWT_SECRET;
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "refreshToken";
const LOGIN_URL = process.env.LOGIN_REDIRECT_URL || "/login";

if (AUTH_ENABLED && !AUTH_SECRET) {
  console.error(
    "[server] REQUIRE_AUTH is enabled but AUTH_JWT_SECRET is not set — refusing to start unprotected.",
  );
  process.exit(1);
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function requireLogin(req, res, next) {
  if (!AUTH_ENABLED) return next();
  const token = parseCookies(req.headers.cookie)[AUTH_COOKIE_NAME];
  if (token) {
    try {
      req.authUser = jwt.verify(token, AUTH_SECRET);
      return next();
    } catch {
      // fall through: expired or forged token counts as logged out
    }
  }
  if ((req.get("accept") || "").includes("text/html")) {
    return res.redirect(LOGIN_URL);
  }
  return res.status(401).json({ error: "Login required." });
}

const router = express.Router();

// Lets the UI know whether the server already holds an API key.
// Public: also usable as a container healthcheck.
router.get("/api/health", (_req, res) => {
  res.json({ ok: true, hasServerKey: Boolean(process.env.OPENAI_API_KEY) });
});

// Everything below — the app itself and the key-minting endpoint — requires
// a valid login when REQUIRE_AUTH is enabled.
router.use(requireLogin);

// Mints an ephemeral client secret so the browser can connect to the
// OpenAI Realtime API over WebRTC without ever seeing the real API key.
router.post("/api/openai/client-secret", async (req, res) => {
  const apiKey = req.get("x-openai-key") || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(400).json({
      error:
        "Missing OpenAI API key: set OPENAI_API_KEY in the server's .env, or paste a key in the page settings.",
    });
  }

  const { model, voice, instructions } = req.body ?? {};
  const session = {
    type: "realtime",
    model: model || "gpt-realtime-2.1",
    audio: {
      output: { voice: voice || "marin" },
    },
  };
  if (instructions) session.instructions = instructions;

  try {
    const upstream = await fetch(`${OPENAI_BASE}/v1/realtime/client_secrets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ session }),
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const message =
        data?.error?.message || `OpenAI 返回 ${upstream.status}`;
      return res.status(upstream.status).json({ error: message });
    }
    res.json({ value: data.value, session: data.session });
  } catch (err) {
    res.status(502).json({ error: `无法访问 OpenAI: ${err.message}` });
  }
});

// Serve the production build when it exists (npm run build && npm start).
// Voice-preview MP3s live in public/ and ship inside dist as static files.
const dist = path.resolve(__dirname, "../dist");
if (fs.existsSync(dist)) {
  router.use(express.static(dist));
  router.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

app.use(BASE_PATH || "/", router);
if (BASE_PATH) {
  app.get("/", (_req, res) => res.redirect(`${BASE_PATH}/`));
}

app.listen(PORT, () => {
  console.log(`[server] token service on http://localhost:${PORT}`);
  console.log(`[server] base path: ${BASE_PATH || "/"}`);
  console.log(
    AUTH_ENABLED
      ? `[server] login required (cookie: ${AUTH_COOKIE_NAME}, redirect: ${LOGIN_URL})`
      : "[server] open access (REQUIRE_AUTH not enabled)",
  );
});
