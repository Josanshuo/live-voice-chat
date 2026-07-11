// Provider-agnostic contract for a realtime voice ("live") backend.
// Every LLM live backend (OpenAI Realtime, Gemini Live, ...) implements
// LiveClient and registers a LiveProvider in registry.ts.

export type LiveStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "closed"
  | "error";

export interface TranscriptItem {
  /** Stable id so partial transcripts update in place. */
  id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

export interface LiveSessionOptions {
  model: string;
  voice?: string;
  instructions?: string;
  /** Dev convenience: API key entered in the UI, forwarded to the token server. */
  apiKeyOverride?: string;
}

export interface LiveClientEventMap {
  status: { status: LiveStatus; detail?: string };
  transcript: TranscriptItem;
  /** Fired when the user starts speaking (useful for barge-in UI). */
  speechStarted: void;
  error: { message: string };
}

type Listener<T> = (payload: T) => void;

export class LiveEmitter {
  private listeners = new Map<string, Set<Listener<unknown>>>();

  on<K extends keyof LiveClientEventMap>(
    event: K,
    fn: Listener<LiveClientEventMap[K]>
  ): () => void {
    let set = this.listeners.get(event as string);
    if (!set) {
      set = new Set();
      this.listeners.set(event as string, set);
    }
    set.add(fn as Listener<unknown>);
    return () => set!.delete(fn as Listener<unknown>);
  }

  protected emit<K extends keyof LiveClientEventMap>(
    event: K,
    payload: LiveClientEventMap[K]
  ): void {
    this.listeners.get(event as string)?.forEach((fn) => fn(payload));
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}

export abstract class LiveClient extends LiveEmitter {
  abstract connect(opts: LiveSessionOptions): Promise<void>;
  abstract disconnect(): void;
  abstract setMuted(muted: boolean): void;
  /** Send a typed message into the live conversation. */
  abstract sendText(text: string): void;
  /** Local microphone stream, once connected. */
  abstract getLocalStream(): MediaStream | null;
  /** Remote (model voice) stream, once connected. */
  abstract getRemoteStream(): MediaStream | null;
}

export interface LiveProvider {
  id: string;
  label: string;
  models: { id: string; label: string }[];
  defaultModel: string;
  voices: string[];
  defaultVoice: string;
  createClient(): LiveClient;
}
