import { LiveProvider } from "./types";
import { openaiProvider } from "./providers/openai";

// To add a new live backend (e.g. Gemini Live):
// 1. implement LiveClient in providers/<name>.ts
// 2. export a LiveProvider and add it to this list
export const providers: LiveProvider[] = [openaiProvider];

export function getProvider(id: string): LiveProvider {
  const p = providers.find((p) => p.id === id);
  if (!p) throw new Error(`未知的 live 后端: ${id}`);
  return p;
}
