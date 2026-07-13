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
const GEMINI_VOICES = [
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Aoede",
  "Leda",
  "Orus",
  "Zephyr",
];

// Gemini TTS returns raw PCM16; wrap it in a WAV header so browsers play it.
function wavFromPcm16(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function generate(provider, voices, synthesize, ext = "mp3") {
  const outDir = path.resolve(__dirname, `../public/voice-previews/${provider}`);
  fs.mkdirSync(outDir, { recursive: true });
  for (const voice of voices) {
    const file = path.join(outDir, `${voice}.${ext}`);
    if (fs.existsSync(file)) {
      console.log(`skip   ${provider}/${voice} (已存在)`);
      continue;
    }
    try {
      const buf = await synthesize(voice);
      fs.writeFileSync(file, buf);
      console.log(`生成   ${provider}/${voice}.${ext} (${(buf.length / 1024).toFixed(0)} KB)`);
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

if (process.env.GEMINI_API_KEY) {
  const GEMINI_BASE =
    process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
  await generate(
    "gemini",
    GEMINI_VOICES,
    async (voice) => {
      const res = await fetch(
        `${GEMINI_BASE}/v1beta/models/gemini-2.5-flash-preview-tts:generateContent`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": process.env.GEMINI_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            // Gemini TTS treats the content as "directive + script"; without
            // a directive it may answer the text instead of reading it.
            contents: [{ parts: [{ text: `用轻快的语气念这句话：${PREVIEW_TEXT}` }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
              },
            },
          }),
        }
      );
      if (!res.ok) {
        throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
      }
      const data = await res.json();
      const b64 = data?.candidates?.[0]?.content?.parts?.find(
        (p) => p.inlineData
      )?.inlineData?.data;
      if (!b64) throw new Error("响应中没有音频数据");
      return wavFromPcm16(Buffer.from(b64, "base64"), 24000);
    },
    "wav"
  );
} else {
  console.log("跳过 gemini（未配置 GEMINI_API_KEY）");
}
