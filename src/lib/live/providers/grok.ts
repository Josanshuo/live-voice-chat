import {
  LiveClient,
  LiveProvider,
  LiveSessionOptions,
  LiveStatus,
} from "../types";
import { withBase } from "../../base";
import { t } from "../../i18n";

// xAI Grok Voice Agent API. Speaks the OpenAI Realtime event protocol, but
// unlike OpenAI it has no browser WebRTC endpoint, so we connect a WebSocket
// directly from the browser (ephemeral token in the subprotocol) and stream
// PCM16 audio both ways through Web Audio:
//   mic → AudioWorklet → base64 PCM16 → input_audio_buffer.append
//   response.output_audio.delta → AudioBuffer queue → MediaStreamDestination
// The MediaStreamDestination's stream doubles as our "remote stream" so the
// rest of the app (audio element, orb visualizer) works exactly like WebRTC.

const AUDIO_RATE = 24000;
const FLUSH_SAMPLES = Math.floor(AUDIO_RATE * 0.04); // send mic audio every ~40ms

const WORKLET_SRC = `
registerProcessor("pcm-capture", class extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
});
`;

function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate) return input;
  const outLen = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(outLen);
  const step = (input.length - 1) / Math.max(1, outLen - 1);
  for (let i = 0; i < outLen; i++) {
    const pos = i * step;
    const i0 = Math.floor(pos);
    const i1 = Math.min(input.length - 1, i0 + 1);
    out[i] = input[i0] + (input[i1] - input[i0]) * (pos - i0);
  }
  return out;
}

function pcm16ToBase64(f32: Float32Array): string {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(i16.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(bin);
}

function base64ToFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(bytes.buffer, 0, bytes.byteLength >> 1);
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
  return f32;
}

class GrokRealtimeClient extends LiveClient {
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
  /** Cumulative user transcripts (xAI sends full text, not deltas). */
  private inputTranscripts = new Map<string, string>();

  async connect(opts: LiveSessionOptions): Promise<void> {
    this.closed = false;
    this.setStatus("connecting", t("openai.gettingKey"));

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (opts.apiKeyOverride) headers["x-xai-key"] = opts.apiKeyOverride;

    const tokenRes = await fetch(withBase("/api/xai/client-secret"), {
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
    const ephemeralKey: string = tokenData.value;

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

    // One 24kHz context for capture and playback. Browsers that ignore the
    // requested rate still work: capture is resampled, playback buffers
    // carry their own rate.
    const ctx = new AudioContext({ sampleRate: AUDIO_RATE });
    this.ctx = ctx;
    await ctx.resume().catch(() => {});
    this.playbackDest = ctx.createMediaStreamDestination();
    this.remoteStream = this.playbackDest.stream;

    this.setStatus("connecting", t("grok.connecting"));
    const ws = new WebSocket(
      `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(opts.model)}`,
      [`xai-client-secret.${ephemeralKey}`]
    );
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(t("grok.connectFailed", "timeout"))),
        15000
      );
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(t("grok.connectFailed", "websocket error")));
      };
    });
    if (this.closed) return this.cleanup();

    const session: Record<string, unknown> = {
      voice: opts.voice || "eve",
      turn_detection: { type: "server_vad" },
      audio: {
        input: {
          format: { type: "audio/pcm", rate: AUDIO_RATE },
          transcription: {},
        },
        output: { format: { type: "audio/pcm", rate: AUDIO_RATE } },
      },
    };
    if (opts.instructions) session.instructions = opts.instructions;
    this.send({ type: "session.update", session });

    ws.onmessage = (e) => {
      try {
        this.handleServerEvent(JSON.parse(e.data));
      } catch {
        /* ignore malformed events */
      }
    };
    ws.onerror = () => {
      if (!this.closed) {
        this.emit("error", { message: t("grok.connectFailed", "websocket error") });
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
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    this.send({ type: "response.create" });
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

  private async startCapture(stream: MediaStream): Promise<void> {
    const ctx = this.ctx!;
    const url = URL.createObjectURL(
      new Blob([WORKLET_SRC], { type: "application/javascript" })
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
    // Route through a muted gain so the graph keeps pulling samples
    // without echoing the mic to the speakers.
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
        AUDIO_RATE
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
          type: "input_audio_buffer.append",
          audio: pcm16ToBase64(merged),
        });
      }
    };
  }

  private playAudioDelta(b64: string): void {
    const ctx = this.ctx;
    const dest = this.playbackDest;
    if (!ctx || !dest) return;
    const f32 = base64ToFloat32(b64);
    if (f32.length === 0) return;
    const buf = ctx.createBuffer(1, f32.length, AUDIO_RATE);
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

  /** Barge-in: drop any queued model audio the moment the user speaks. */
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

  private send(event: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  private setStatus(status: LiveStatus, detail?: string): void {
    this.emit("status", { status, detail });
  }

  private handleServerEvent(ev: Record<string, any>): void {
    switch (ev.type) {
      case "response.output_audio.delta":
        this.playAudioDelta(ev.delta ?? "");
        break;

      // xAI's "updated" carries the cumulative transcript; emit only the
      // new suffix because the app accumulates non-final deltas.
      case "conversation.item.input_audio_transcription.updated": {
        const full = String(ev.transcript ?? "");
        const prev = this.inputTranscripts.get(ev.item_id) ?? "";
        this.inputTranscripts.set(ev.item_id, full);
        if (full.startsWith(prev)) {
          const delta = full.slice(prev.length);
          if (delta) {
            this.emit("transcript", {
              id: `in-${ev.item_id}`,
              role: "user",
              text: delta,
              final: false,
            });
          }
        } else {
          // Revision instead of extension: replace via a final item.
          this.emit("transcript", {
            id: `in-${ev.item_id}`,
            role: "user",
            text: full,
            final: true,
          });
        }
        break;
      }
      case "conversation.item.input_audio_transcription.delta":
        this.emit("transcript", {
          id: `in-${ev.item_id}`,
          role: "user",
          text: ev.delta ?? "",
          final: false,
        });
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.inputTranscripts.delete(ev.item_id);
        this.emit("transcript", {
          id: `in-${ev.item_id}`,
          role: "user",
          text: ev.transcript ?? "",
          final: true,
        });
        break;

      case "response.output_audio_transcript.delta":
        this.emit("transcript", {
          id: `out-${ev.response_id}`,
          role: "assistant",
          text: ev.delta ?? "",
          final: false,
        });
        break;
      case "response.output_audio_transcript.done":
        this.emit("transcript", {
          id: `out-${ev.response_id}`,
          role: "assistant",
          text: ev.transcript ?? "",
          final: true,
        });
        break;

      case "input_audio_buffer.speech_started":
        this.stopPlayback();
        this.emit("speechStarted", undefined);
        break;

      case "error":
        this.emit("error", {
          message: ev.error?.message ?? t("openai.unknownError"),
        });
        break;
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
    this.inputTranscripts.clear();
  }
}

export const grokProvider: LiveProvider = {
  id: "grok",
  get label() {
    return t("grok.providerLabel");
  },
  models: [
    {
      id: "grok-voice-latest",
      get label() {
        return t("grok.modelFlagship");
      },
    },
  ],
  defaultModel: "grok-voice-latest",
  voices: ["eve", "ara", "rex", "sal", "leo"],
  defaultVoice: "eve",
  createClient: () => new GrokRealtimeClient(),
  voicePreviewUrl: (voice: string) =>
    withBase(`/voice-previews/grok/${encodeURIComponent(voice)}.mp3`),
};
