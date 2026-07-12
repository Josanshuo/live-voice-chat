// One-time generator for the voice-preview MP3s served from
// public/voice-previews/. Rerun after adding voices:  npm run gen-previews
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

const OPENAI_BASE = process.env.OPENAI_BASE_URL || "https://api.openai.com";
const PREVIEW_TEXT = "你好呀，这是我的声音，喜欢就选我吧！";
// keep in sync with voices in src/lib/live/providers/openai.ts
const VOICES = [
  "marin",
  "cedar",
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
];

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("缺少 OPENAI_API_KEY（.env）");
  process.exit(1);
}

const outDir = path.resolve(__dirname, "../public/voice-previews/openai");
fs.mkdirSync(outDir, { recursive: true });

for (const voice of VOICES) {
  const file = path.join(outDir, `${voice}.mp3`);
  if (fs.existsSync(file)) {
    console.log(`skip   ${voice} (已存在)`);
    continue;
  }
  const res = await fetch(`${OPENAI_BASE}/v1/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice,
      input: PREVIEW_TEXT,
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    console.error(`失败   ${voice}: ${res.status} ${(await res.text()).slice(0, 120)}`);
    process.exitCode = 1;
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  console.log(`生成   ${voice}.mp3 (${(buf.length / 1024).toFixed(0)} KB)`);
}
