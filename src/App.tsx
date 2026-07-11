import { useEffect, useRef, useState } from "react";
import Orb from "./components/Orb";
import TranscriptView from "./components/TranscriptView";
import SettingsPanel, { Settings } from "./components/SettingsPanel";
import { getProvider, providers } from "./lib/live/registry";
import { LiveClient, LiveStatus, TranscriptItem } from "./lib/live/types";

const SETTINGS_KEY = "voice-live-settings";

function loadSettings(): Settings {
  const defaults: Settings = {
    providerId: providers[0].id,
    model: providers[0].defaultModel,
    voice: providers[0].defaultVoice,
    instructions: "",
    apiKey: "",
  };
  try {
    const s: Settings = {
      ...defaults,
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}"),
    };
    // Saved settings may reference a backend/model/voice that no longer
    // exists in the registry; fall back to defaults so the picker always
    // has a valid selection.
    const provider = providers.find((p) => p.id === s.providerId) ?? providers[0];
    s.providerId = provider.id;
    if (!provider.models.some((m) => m.id === s.model)) {
      s.model = provider.defaultModel;
    }
    if (!provider.voices.includes(s.voice)) {
      s.voice = provider.defaultVoice;
    }
    return s;
  } catch {
    return defaults;
  }
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [statusDetail, setStatusDetail] = useState<string>("");
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [muted, setMuted] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  // Mobile-only bottom sheets; on desktop both panels are always visible.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [hasServerKey, setHasServerKey] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const clientRef = useRef<LiveClient | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setHasServerKey(Boolean(d.hasServerKey)))
      .catch(() => setHasServerKey(false));
  }, []);

  // The remote stream shows up shortly after connecting; poll for it and
  // wire it to the audio element + orb once present.
  useEffect(() => {
    if (status !== "connected") return;
    const timer = setInterval(() => {
      const remote = clientRef.current?.getRemoteStream() ?? null;
      if (remote) {
        setRemoteStream(remote);
        if (audioRef.current && audioRef.current.srcObject !== remote) {
          audioRef.current.srcObject = remote;
          audioRef.current.play().catch(() => {});
        }
        clearInterval(timer);
      }
    }, 200);
    return () => clearInterval(timer);
  }, [status]);

  const applyTranscript = (item: TranscriptItem) => {
    setTranscripts((prev) => {
      const idx = prev.findIndex((t) => t.id === item.id);
      if (idx === -1) return [...prev, item];
      const next = [...prev];
      next[idx] = item.final
        ? item // final events carry the full transcript
        : { ...item, text: next[idx].text + item.text }; // deltas accumulate
      return next;
    });
  };

  const startCall = async () => {
    const provider = getProvider(settings.providerId);
    const client = provider.createClient();
    clientRef.current = client;
    setTranscripts([]);
    setMuted(false);
    setRemoteStream(null);

    client.on("status", ({ status, detail }) => {
      setStatus(status);
      setStatusDetail(detail ?? "");
    });
    client.on("transcript", applyTranscript);
    client.on("error", ({ message }) => setStatusDetail(message));

    try {
      await client.connect({
        model: settings.model,
        voice: settings.voice,
        instructions: settings.instructions || undefined,
        apiKeyOverride: hasServerKey ? undefined : settings.apiKey || undefined,
      });
      setLocalStream(client.getLocalStream());
    } catch (err) {
      // Unhook listeners before disconnect(), which emits a "closed" status
      // that would overwrite the error we are about to show.
      client.removeAllListeners();
      client.disconnect();
      clientRef.current = null;
      setStatus("error");
      setStatusDetail(err instanceof Error ? err.message : String(err));
    }
  };

  const endCall = () => {
    clientRef.current?.disconnect();
    clientRef.current?.removeAllListeners();
    clientRef.current = null;
    setStatus("idle");
    setStatusDetail("");
    setLocalStream(null);
    setRemoteStream(null);
    if (audioRef.current) audioRef.current.srcObject = null;
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    clientRef.current?.setMuted(next);
  };

  const sendText = () => {
    const text = textDraft.trim();
    if (!text) return;
    clientRef.current?.sendText(text);
    setTextDraft("");
  };

  const inCall = status === "connecting" || status === "connected";
  const lastTranscript = transcripts[transcripts.length - 1];
  const sheetOpen = settingsOpen || transcriptOpen;
  const closeSheets = () => {
    setSettingsOpen(false);
    setTranscriptOpen(false);
  };

  const statusLabel: Record<LiveStatus, string> = {
    idle: "点击下方按钮开始语音对话",
    connecting: "连接中…",
    connected: muted ? "已静音" : "正在通话 · 直接开口说话即可",
    closed: "通话已结束",
    error: "出错了",
  };

  return (
    <div className="app">
      <audio ref={audioRef} autoPlay />

      <header className="header">
        <h1>Voice Live</h1>
        <span className="header-sub">多后端 LLM 实时语音 · MVP: OpenAI Realtime</span>
        <div className="header-actions">
          <button
            className="icon-btn"
            onClick={() => {
              setTranscriptOpen(true);
              setSettingsOpen(false);
            }}
          >
            字幕
          </button>
          <button
            className="icon-btn"
            onClick={() => {
              setSettingsOpen(true);
              setTranscriptOpen(false);
            }}
          >
            设置
          </button>
        </div>
      </header>

      <div className="layout">
        {sheetOpen && <div className="backdrop" onClick={closeSheets} />}

        <aside className={`sidebar ${settingsOpen ? "sheet-open" : ""}`}>
          <div className="sheet-header">
            <span>设置</span>
            <button className="icon-btn" onClick={closeSheets}>
              完成
            </button>
          </div>
          <SettingsPanel
            settings={settings}
            onChange={setSettings}
            disabled={inCall}
            hasServerKey={hasServerKey}
          />
        </aside>

        <main className="stage">
          <Orb
            localStream={localStream}
            remoteStream={remoteStream}
            active={status === "connected"}
          />
          <div className={`status status-${status}`}>
            {statusLabel[status]}
            {statusDetail && <div className="status-detail">{statusDetail}</div>}
          </div>

          {lastTranscript && (
            <button className="captions" onClick={() => setTranscriptOpen(true)}>
              <span className="captions-role">
                {lastTranscript.role === "user" ? "你" : "AI"}
              </span>
              {lastTranscript.text || "…"}
            </button>
          )}

          <div className="controls">
            {!inCall ? (
              <button className="btn btn-primary" onClick={startCall}>
                开始通话
              </button>
            ) : (
              <>
                <button className="btn btn-danger" onClick={endCall}>
                  结束
                </button>
                <button
                  className={`btn ${muted ? "btn-active" : ""}`}
                  onClick={toggleMute}
                  disabled={status !== "connected"}
                >
                  {muted ? "取消静音" : "静音"}
                </button>
              </>
            )}
          </div>

          {status === "connected" && (
            <div className="text-input">
              <input
                value={textDraft}
                placeholder="也可以打字发送…"
                onChange={(e) => setTextDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendText()}
              />
              <button className="btn" onClick={sendText}>
                发送
              </button>
            </div>
          )}
        </main>

        <aside className={`transcript-panel ${transcriptOpen ? "sheet-open" : ""}`}>
          <div className="sheet-header">
            <span>字幕</span>
            <button className="icon-btn" onClick={closeSheets}>
              完成
            </button>
          </div>
          <TranscriptView items={transcripts} />
        </aside>
      </div>
    </div>
  );
}
