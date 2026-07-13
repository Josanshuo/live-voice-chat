import { useSyncExternalStore } from "react";

// Tiny dependency-free i18n. Default language follows the browser
// (navigator.language starting with "zh" → Chinese, anything else →
// English); an explicit choice from the header toggle is persisted and
// wins on the next visit. Non-React code (providers, registry) calls t()
// directly; components subscribe via useLang() so a switch re-renders
// the whole tree.

export type Lang = "en" | "zh";

const LANG_KEY = "voice-live-lang";

const en = {
  "header.subtitle": "Multi-backend realtime LLM voice · OpenAI + Grok + Gemini",
  "nav.transcript": "Captions",
  "nav.settings": "Settings",
  "nav.done": "Done",

  "status.idle": "Click the button below to start a voice chat",
  "status.connecting": "Connecting…",
  "status.muted": "Muted",
  "status.live": "In call · just start talking",
  "status.closed": "Call ended",
  "status.error": "Something went wrong",

  "role.you": "You",
  "role.ai": "AI",

  "call.start": "Start call",
  "call.end": "End",
  "call.mute": "Mute",
  "call.unmute": "Unmute",
  "input.placeholder": "Or type a message…",
  "input.send": "Send",

  "transcript.empty": "Conversation captions will appear here",

  "settings.locked": "Settings are locked during a call; end the call to make changes",
  "settings.model": "Model",
  "settings.voice": "Voice",
  "settings.voicePreviewHint": " (click to preview)",
  "settings.instructions": "System instructions (optional)",
  "settings.instructionsPlaceholder":
    "e.g. You are a friendly voice assistant. Keep replies short.",
  "settings.apiKeyPlaceholder": "sk-... (only if the server has no key configured)",
  "settings.apiKeyNote":
    "Stored only in this browser's localStorage and sent only to the token service. Prefer setting OPENAI_API_KEY in the project .env.",

  "openai.providerLabel": "OpenAI (the engine behind ChatGPT voice)",
  "openai.modelFlagship": "Flagship · gpt-realtime-2.1 (ChatGPT voice)",
  "openai.modelMini": "Fast & cheap · gpt-realtime-2.1-mini",
  "openai.gettingKey": "Getting ephemeral key…",
  "openai.keyFailed": "Failed to get ephemeral key",
  "openai.requestingMic": "Requesting microphone…",
  "openai.connectingWebrtc": "Establishing WebRTC connection…",
  "openai.webrtcFailed": "WebRTC connection failed",
  "openai.disconnected": "Connection lost",
  "openai.micUnavailable":
    "Microphone unavailable: text-only mode, you can still hear the AI",
  "openai.sessionEnded": "Session ended",
  "openai.connectFailed": "Realtime connection failed ({0}): {1}",
  "openai.unknownError": "Unknown error",

  "grok.providerLabel": "xAI Grok",
  "grok.modelFlagship": "grok-voice-latest (the engine behind Grok voice)",
  "grok.connecting": "Connecting to Grok…",
  "grok.connectFailed": "Grok connection failed ({0})",

  "gemini.providerLabel": "Google Gemini",
  "gemini.modelFlagship":
    "gemini-3.1-flash-live-preview (the engine behind Gemini Live)",
  "gemini.connecting": "Connecting to Gemini…",
  "gemini.connectFailed": "Gemini connection failed ({0})",

  "registry.unknownBackend": "Unknown live backend: {0}",
};

export type MsgKey = keyof typeof en;

const zh: Record<MsgKey, string> = {
  "header.subtitle": "多后端 LLM 实时语音 · OpenAI + Grok + Gemini",
  "nav.transcript": "字幕",
  "nav.settings": "设置",
  "nav.done": "完成",

  "status.idle": "点击下方按钮开始语音对话",
  "status.connecting": "连接中…",
  "status.muted": "已静音",
  "status.live": "正在通话 · 直接开口说话即可",
  "status.closed": "通话已结束",
  "status.error": "出错了",

  "role.you": "你",
  "role.ai": "AI",

  "call.start": "开始通话",
  "call.end": "结束",
  "call.mute": "静音",
  "call.unmute": "取消静音",
  "input.placeholder": "也可以打字发送…",
  "input.send": "发送",

  "transcript.empty": "对话字幕会显示在这里",

  "settings.locked": "通话中无法更改设置，结束通话后即可修改",
  "settings.model": "模型",
  "settings.voice": "声音",
  "settings.voicePreviewHint": "（点击试听）",
  "settings.instructions": "系统指令（可选）",
  "settings.instructionsPlaceholder":
    "例如：你是一个友善的中文语音助手，回答尽量简短。",
  "settings.apiKeyPlaceholder": "sk-...（服务器未配置 key 时填写）",
  "settings.apiKeyNote":
    "仅保存在本机浏览器 localStorage，并只发送给 token 服务。推荐改用项目根目录 .env 配置 OPENAI_API_KEY。",

  "openai.providerLabel": "OpenAI（ChatGPT 语音同款）",
  "openai.modelFlagship": "旗舰版 · gpt-realtime-2.1（ChatGPT 语音同款）",
  "openai.modelMini": "高速省钱版 · gpt-realtime-2.1-mini",
  "openai.gettingKey": "获取临时密钥…",
  "openai.keyFailed": "获取临时密钥失败",
  "openai.requestingMic": "请求麦克风…",
  "openai.connectingWebrtc": "建立 WebRTC 连接…",
  "openai.webrtcFailed": "WebRTC 连接失败",
  "openai.disconnected": "连接已断开",
  "openai.micUnavailable": "麦克风不可用：已进入文字模式，仍可听到 AI 语音",
  "openai.sessionEnded": "会话已结束",
  "openai.connectFailed": "Realtime 连接失败 ({0}): {1}",
  "openai.unknownError": "未知错误",

  "grok.providerLabel": "xAI Grok",
  "grok.modelFlagship": "grok-voice-latest（Grok 语音同款）",
  "grok.connecting": "正在连接 Grok…",
  "grok.connectFailed": "Grok 连接失败 ({0})",

  "gemini.providerLabel": "Google Gemini",
  "gemini.modelFlagship": "gemini-3.1-flash-live-preview（Gemini Live 同款）",
  "gemini.connecting": "正在连接 Gemini…",
  "gemini.connectFailed": "Gemini 连接失败 ({0})",

  "registry.unknownBackend": "未知的 live 后端: {0}",
};

const messages: Record<Lang, Record<MsgKey, string>> = { en, zh };

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "en" || saved === "zh") return saved;
  } catch {
    // localStorage can be unavailable (private mode); fall through
  }
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

let current: Lang = detectLang();
const listeners = new Set<() => void>();

function applyHtmlLang() {
  document.documentElement.lang = current === "zh" ? "zh-CN" : "en";
}
applyHtmlLang();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // best effort; the choice just won't persist
  }
  applyHtmlLang();
  listeners.forEach((fn) => fn());
}

/** React subscription: components re-render when the language changes. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

/** Translate a key; "{0}", "{1}", … are replaced with args. */
export function t(key: MsgKey, ...args: (string | number)[]): string {
  let text = messages[current][key];
  args.forEach((arg, i) => {
    text = text.replace(`{${i}}`, String(arg));
  });
  return text;
}
