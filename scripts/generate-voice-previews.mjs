// One-time generator for the voice-preview MP3s served from
// public/voice-previews/. Rerun after adding voices:  npm run gen-previews
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

const OPENAI_BASE = process.env.OPENAI_BASE_URL || "https://api.openai.com";
const XAI_BASE = process.env.XAI_BASE_URL || "https://api.x.ai";
const PREVIEW_TEXT = "你好呀，这是我的声音，喜欢就选我吧！";

// keep in sync with the voices in src/lib/live/providers/*
const OPENAI_VOICES = [
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
const GROK_VOICES = ["eve", "ara", "rex", "sal", "leo"];

async function generate(provider, voices, synthesize) {
  const outDir = path.resolve(__dirname, `../public/voice-previews/${provider}`);
  fs.mkdirSync(outDir, { recursive: true });
  for (const voice of voices) {
    const file = path.join(outDir, `${voice}.mp3`);
    if (fs.existsSync(file)) {
      console.log(`skip   ${provider}/${voice} (已存在)`);
      continue;
    }
    try {
      const buf = await synthesize(voice);
      fs.writeFileSync(file, buf);
      console.log(`生成   ${provider}/${voice}.mp3 (${(buf.length / 1024).toFixed(0)} KB)`);
    } catch (err) {
      console.error(`失败   ${provider}/${voice}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

async function readAudio(res) {
  if (!res.ok) {
    throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

if (process.env.OPENAI_API_KEY) {
  await generate("openai", OPENAI_VOICES, async (voice) =>
    readAudio(
      await fetch(`${OPENAI_BASE}/v1/audio/speech`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          voice,
          input: PREVIEW_TEXT,
          response_format: "mp3",
        }),
      })
    )
  );
} else {
  console.log("跳过 openai（未配置 OPENAI_API_KEY）");
}

if (process.env.XAI_API_KEY) {
  await generate("grok", GROK_VOICES, async (voice) =>
    readAudio(
      await fetch(`${XAI_BASE}/v1/tts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.XAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: PREVIEW_TEXT,
          voice_id: voice,
          language: "zh",
        }),
      })
    )
  );
} else {
  console.log("跳过 grok（未配置 XAI_API_KEY）");
}
