import {
  LiveClient,
  LiveProvider,
  LiveSessionOptions,
  LiveStatus,
} from "../types";
import { withBase } from "../../base";
import { t } from "../../i18n";
import {
  CAPTURE_WORKLET_SRC,
  base64ToFloat32,
  pcm16ToBase64,
  resampleLinear,
} from "../audio";

// Google Gemini Live API (BidiGenerateContent over WebSocket). Unlike
// OpenAI/Grok it speaks its own protocol: a "setup" message opens the
// session, mic audio streams as "realtimeInput" (PCM16 @16kHz), model audio
// arrives inside "serverContent" (PCM16 @24kHz), and transcriptions arrive
// as incremental text fragments without item ids — we group them into
// bubbles by turn. Auth uses an ephemeral token minted by our server
// (v1alpha auth_tokens), so the real API key never reaches the browser.

const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;
const FLUSH_SAMPLES = Math.floor(INPUT_RATE * 0.04); // ~40ms per chunk

// Ephemeral tokens are only accepted by the "Constrained" RPC variant;
// the plain BidiGenerateContent endpoint ignores access_token entirely.
const WS_URL =
  "wss://generativelanguage.googleapis.com/ws/" +
  "google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

class GeminiLiveClient extends LiveClient {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private playbackDest: MediaStreamAudioDestinationNode | null = null;
  private captureNode: AudioWorkletNode | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private activeSources = new Set<AudioBufferSourceNode>();
  private nextPlayTime = 0;
  private muted = false;
  private closed = false;
  // Transcription fragments carry no ids; we bucket them by turn counters.
  private inTurn = 0;
  private outTurn = 0;
  private inText = "";
  private outText = "";

  async connect(opts: LiveSessionOptions): Promise<void> {
    this.closed = false;
    this.setStatus("connecting", t("openai.gettingKey"));

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (opts.apiKeyOverride) headers["x-gemini-key"] = opts.apiKeyOverride;

    const tokenRes = await fetch(withBase("/api/gemini/client-secret"), {
      method: "POST",
      headers,
      body: JSON.stringify({ model: opts.model }),
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData.value) {
      throw new Error(
        tokenData.error || `${t("openai.keyFailed")} (HTTP ${tokenRes.status})`
      );
    }
    const ephemeralToken: string = tokenData.value;

    this.setStatus("connecting", t("openai.requestingMic"));
    let micAvailable = true;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      this.localStream = null;
      micAvailable = false;
    }
    if (this.closed) return this.cleanup();

    const ctx = new AudioContext({ sampleRate: OUTPUT_RATE });
    this.ctx = ctx;
    await ctx.resume().catch(() => {});
    this.playbackDest = ctx.createMediaStreamDestination();
    this.remoteStream = this.playbackDest.stream;

    this.setStatus("connecting", t("gemini.connecting"));
    const ws = new WebSocket(
      `${WS_URL}?access_token=${encodeURIComponent(ephemeralToken)}`
    );
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(t("gemini.connectFailed", "timeout"))),
        15000
      );
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(t("gemini.connectFailed", "websocket error")));
      };
    });
    if (this.closed) return this.cleanup();

    const setup: Record<string, any> = {
      model: `models/${opts.model}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: opts.voice || "Puck" },
          },
        },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    };
    if (opts.instructions) {
      setup.systemInstruction = { parts: [{ text: opts.instructions }] };
    }
    ws.send(JSON.stringify({ setup }));

    // The session is usable once the server acks the setup.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(t("gemini.connectFailed", "setup timeout"))),
        15000
      );
      ws.onmessage = async (e) => {
        const msg = await this.parseMessage(e.data);
        if (msg?.setupComplete !== undefined) {
          clearTimeout(timer);
          resolve();
        } else if (msg) {
          this.handleServerMessage(msg);
        }
      };
      ws.onclose = (ev) => {
        clearTimeout(timer);
        reject(
          new Error(t("gemini.connectFailed", `${ev.code} ${ev.reason || ""}`))
        );
      };
    });
    if (this.closed) return this.cleanup();

    ws.onmessage = async (e) => {
      const msg = await this.parseMessage(e.data);
      if (msg) this.handleServerMessage(msg);
    };
    ws.onerror = () => {
      if (!this.closed) {
        this.emit("error", {
          message: t("gemini.connectFailed", "websocket error"),
        });
      }
    };
    ws.onclose = () => {
      if (!this.closed) this.setStatus("closed", t("openai.sessionEnded"));
    };

    if (micAvailable && this.localStream) {
      await this.startCapture(this.localStream);
    }
    if (this.closed) return this.cleanup();

    this.setStatus(
      "connected",
      micAvailable ? undefined : t("openai.micUnavailable")
    );
  }

  disconnect(): void {
    this.closed = true;
    this.cleanup();
    this.setStatus("closed");
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.localStream
      ?.getAudioTracks()
      .forEach((track) => (track.enabled = !muted));
  }

  sendText(text: string): void {
    this.send({
      clientContent: {
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      },
    });
    this.emit("transcript", {
      id: `local-${Date.now()}`,
      role: "user",
      text,
      final: true,
    });
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  // ---- internals ----

  private async parseMessage(data: unknown): Promise<Record<string, any> | null> {
    try {
      const text =
        data instanceof Blob ? await data.text() : String(data);
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private send(message: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private setStatus(status: LiveStatus, detail?: string): void {
    this.emit("status", { status, detail });
  }

  private async startCapture(stream: MediaStream): Promise<void> {
    const ctx = this.ctx!;
    const url = URL.createObjectURL(
      new Blob([CAPTURE_WORKLET_SRC], { type: "application/javascript" })
    );
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (this.closed) return;

    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm-capture");
    this.captureNode = node;
    const silent = ctx.createGain();
    silent.gain.value = 0;
    source.connect(node);
    node.connect(silent);
    silent.connect(ctx.destination);

    let pending: Float32Array[] = [];
    let pendingSamples = 0;
    node.port.onmessage = (e) => {
      if (this.muted || this.ws?.readyState !== WebSocket.OPEN) return;
      const chunk = resampleLinear(
        e.data as Float32Array,
        ctx.sampleRate,
        INPUT_RATE
      );
      pending.push(chunk);
      pendingSamples += chunk.length;
      if (pendingSamples >= FLUSH_SAMPLES) {
        const merged = new Float32Array(pendingSamples);
        let off = 0;
        for (const c of pending) {
          merged.set(c, off);
          off += c.length;
        }
        pending = [];
        pendingSamples = 0;
        this.send({
          realtimeInput: {
            audio: {
              data: pcm16ToBase64(merged),
              mimeType: `audio/pcm;rate=${INPUT_RATE}`,
            },
          },
        });
      }
    };
  }

  private playAudioChunk(b64: string): void {
    const ctx = this.ctx;
    const dest = this.playbackDest;
    if (!ctx || !dest) return;
    const f32 = base64ToFloat32(b64);
    if (f32.length === 0) return;
    const buf = ctx.createBuffer(1, f32.length, OUTPUT_RATE);
    buf.getChannelData(0).set(f32);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(dest);
    const startAt = Math.max(ctx.currentTime + 0.02, this.nextPlayTime);
    src.start(startAt);
    this.nextPlayTime = startAt + buf.duration;
    this.activeSources.add(src);
    src.onended = () => this.activeSources.delete(src);
  }

  private stopPlayback(): void {
    for (const src of this.activeSources) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    this.activeSources.clear();
    this.nextPlayTime = 0;
  }

  private finalizeTurn(): void {
    if (this.inText) {
      this.emit("transcript", {
        id: `gin-${this.inTurn}`,
        role: "user",
        text: this.inText,
        final: true,
      });
      this.inTurn++;
      this.inText = "";
    }
    if (this.outText) {
      this.emit("transcript", {
        id: `gout-${this.outTurn}`,
        role: "assistant",
        text: this.outText,
        final: true,
      });
      this.outTurn++;
      this.outText = "";
    }
  }

  private handleServerMessage(msg: Record<string, any>): void {
    const sc = msg.serverContent;
    if (!sc) {
      if (msg.error) {
        this.emit("error", {
          message: msg.error?.message ?? t("openai.unknownError"),
        });
      }
      return;
    }

    // Barge-in: the model was interrupted by the user speaking.
    if (sc.interrupted) {
      this.stopPlayback();
      this.emit("speechStarted", undefined);
      this.finalizeTurn();
      return;
    }

    if (sc.inputTranscription?.text) {
      this.inText += sc.inputTranscription.text;
      this.emit("transcript", {
        id: `gin-${this.inTurn}`,
        role: "user",
        text: sc.inputTranscription.text,
        final: false,
      });
    }
    if (sc.outputTranscription?.text) {
      this.outText += sc.outputTranscription.text;
      this.emit("transcript", {
        id: `gout-${this.outTurn}`,
        role: "assistant",
        text: sc.outputTranscription.text,
        final: false,
      });
    }

    const parts = sc.modelTurn?.parts ?? [];
    for (const part of parts) {
      const data = part.inlineData;
      if (data?.data && String(data.mimeType || "").startsWith("audio/pcm")) {
        this.playAudioChunk(data.data);
      }
    }

    if (sc.turnComplete) {
      this.finalizeTurn();
    }
  }

  private cleanup(): void {
    if (this.captureNode) {
      this.captureNode.port.onmessage = null;
      this.captureNode.disconnect();
      this.captureNode = null;
    }
    this.stopPlayback();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.playbackDest = null;
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.remoteStream = null;
    this.inText = "";
    this.outText = "";
  }
}

export const geminiProvider: LiveProvider = {
  id: "gemini",
  get label() {
    return t("gemini.providerLabel");
  },
  models: [
    {
      id: "gemini-3.1-flash-live-preview",
      get label() {
        return t("gemini.modelFlagship");
      },
    },
  ],
  defaultModel: "gemini-3.1-flash-live-preview",
  voices: ["Puck", "Charon", "Kore", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr"],
  defaultVoice: "Puck",
  createClient: () => new GeminiLiveClient(),
  // Samples are generated by `npm run gen-previews` (needs GEMINI_API_KEY);
  // clicking a voice before they exist just selects it without sound.
  voicePreviewUrl: (voice: string) =>
    withBase(`/voice-previews/gemini/${encodeURIComponent(voice)}.wav`),
};
