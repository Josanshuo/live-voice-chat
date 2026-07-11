import dotenv from "dotenv";
import express from "express";
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

// Lets the UI know whether the server already holds an API key.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, hasServerKey: Boolean(process.env.OPENAI_API_KEY) });
});

// Mints an ephemeral client secret so the browser can connect to the
// OpenAI Realtime API over WebRTC without ever seeing the real API key.
app.post("/api/openai/client-secret", async (req, res) => {
  const apiKey = req.get("x-openai-key") || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(400).json({
      error:
        "缺少 OpenAI API key：请在项目根目录的 .env 中设置 OPENAI_API_KEY，或在页面设置中填入 key。",
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
const dist = path.resolve(__dirname, "../dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`[server] token service on http://localhost:${PORT}`);
});
