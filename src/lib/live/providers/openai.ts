import {
  LiveClient,
  LiveProvider,
  LiveSessionOptions,
  LiveStatus,
} from "../types";
import { withBase } from "../../base";

// OpenAI Realtime API over WebRTC.
// Flow: ask our server for an ephemeral client secret, then connect the
// browser directly to OpenAI (SDP exchange via /v1/realtime/calls) so audio
// never passes through our server. Events flow over the "oai-events"
// data channel.

class OpenAIRealtimeClient extends LiveClient {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private closed = false;

  async connect(opts: LiveSessionOptions): Promise<void> {
    this.closed = false;
    this.setStatus("connecting", "获取临时密钥…");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (opts.apiKeyOverride) headers["x-openai-key"] = opts.apiKeyOverride;

    const tokenRes = await fetch(withBase("/api/openai/client-secret"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: opts.model,
        voice: opts.voice,
        instructions: opts.instructions,
      }),
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData.value) {
      throw new Error(tokenData.error || "获取临时密钥失败");
    }
    const ephemeralKey: string = tokenData.value;

    this.setStatus("connecting", "请求麦克风…");
    let micAvailable = true;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      // No mic (denied or missing): fall back to text-in / voice-out mode.
      this.localStream = null;
      micAvailable = false;
    }
    if (this.closed) return this.cleanup();

    this.setStatus("connecting", "建立 WebRTC 连接…");
    const pc = new RTCPeerConnection();
    this.pc = pc;

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    } else {
      // Still negotiate an inbound audio track so the model voice plays.
      pc.addTransceiver("audio", { direction: "recvonly" });
    }

    pc.ontrack = (e) => {
      this.remoteStream = e.streams[0] ?? new MediaStream([e.track]);
    };
    pc.onconnectionstatechange = () => {
      if (this.closed) return;
      if (pc.connectionState === "failed") {
        this.emit("error", { message: "WebRTC 连接失败" });
        this.setStatus("error", "WebRTC 连接失败");
      } else if (pc.connectionState === "disconnected") {
        this.setStatus("closed", "连接已断开");
      }
    };

    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    dc.onopen = () => {
      // Turn on input transcription so we can show what the user said.
      this.send({
        type: "session.update",
        session: {
          type: "realtime",
          audio: {
            input: {
              transcription: { model: "gpt-4o-mini-transcribe" },
            },
          },
        },
      });
      this.setStatus(
        "connected",
        micAvailable ? undefined : "麦克风不可用：已进入文字模式，仍可听到 AI 语音"
      );
    };
    dc.onmessage = (e) => {
      try {
        this.handleServerEvent(JSON.parse(e.data));
      } catch {
        /* ignore malformed events */
      }
    };
    dc.onclose = () => {
      if (!this.closed) this.setStatus("closed", "会话已结束");
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        "Content-Type": "application/sdp",
      },
    });
    if (!sdpRes.ok) {
      const text = await sdpRes.text().catch(() => "");
      throw new Error(`Realtime 连接失败 (${sdpRes.status}): ${text.slice(0, 200)}`);
    }
    const answerSdp = await sdpRes.text();
    if (this.closed) return this.cleanup();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  }

  disconnect(): void {
    this.closed = true;
    this.cleanup();
    this.setStatus("closed");
  }

  setMuted(muted: boolean): void {
    this.localStream
      ?.getAudioTracks()
      .forEach((t) => (t.enabled = !muted));
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

  private send(event: Record<string, unknown>): void {
    if (this.dc?.readyState === "open") {
      this.dc.send(JSON.stringify(event));
    }
  }

  private setStatus(status: LiveStatus, detail?: string): void {
    this.emit("status", { status, detail });
  }

  private handleServerEvent(ev: Record<string, any>): void {
    switch (ev.type) {
      // User speech transcription (may arrive as deltas, always ends with completed).
      case "conversation.item.input_audio_transcription.delta":
        this.emit("transcript", {
          id: `in-${ev.item_id}`,
          role: "user",
          text: ev.delta ?? "",
          final: false,
        });
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.emit("transcript", {
          id: `in-${ev.item_id}`,
          role: "user",
          text: ev.transcript ?? "",
          final: true,
        });
        break;

      // Assistant speech transcript. GA event names, with the older beta
      // names ("response.audio_transcript.*") handled as fallback.
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
        this.emit("transcript", {
          id: `out-${ev.response_id}`,
          role: "assistant",
          text: ev.delta ?? "",
          final: false,
        });
        break;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        this.emit("transcript", {
          id: `out-${ev.response_id}`,
          role: "assistant",
          text: ev.transcript ?? "",
          final: true,
        });
        break;

      case "input_audio_buffer.speech_started":
        this.emit("speechStarted", undefined);
        break;

      case "error":
        this.emit("error", { message: ev.error?.message ?? "未知错误" });
        break;
    }
  }

  private cleanup(): void {
    this.dc?.close();
    this.dc = null;
    this.pc?.close();
    this.pc = null;
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.remoteStream = null;
  }
}

export const openaiProvider: LiveProvider = {
  id: "openai",
  label: "OpenAI（ChatGPT 语音同款）",
  // Two tiers per backend: flagship & fast/cheap. The UI merges
  // backend + model into a single picker.
  models: [
    {
      id: "gpt-realtime-2.1",
      label: "旗舰版 · gpt-realtime-2.1（ChatGPT 语音同款）",
    },
    {
      id: "gpt-realtime-2.1-mini",
      label: "高速省钱版 · gpt-realtime-2.1-mini",
    },
  ],
  defaultModel: "gpt-realtime-2.1",
  voices: [
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
  ],
  defaultVoice: "marin",
  createClient: () => new OpenAIRealtimeClient(),
  // Pre-generated with `npm run gen-previews`, served as static files.
  voicePreviewUrl: (voice: string) =>
    withBase(`/voice-previews/openai/${encodeURIComponent(voice)}.mp3`),
};
