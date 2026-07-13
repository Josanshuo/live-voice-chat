import { LiveProvider } from "./types";
import { openaiProvider } from "./providers/openai";
import { grokProvider } from "./providers/grok";
import { geminiProvider } from "./providers/gemini";
import { t } from "../i18n";

// To add a new live backend:
// 1. implement LiveClient in providers/<name>.ts
// 2. export a LiveProvider and add it to this list
export const providers: LiveProvider[] = [
  openaiProvider,
  grokProvider,
  geminiProvider,
];

export function getProvider(id: string): LiveProvider {
  const p = providers.find((p) => p.id === id);
  if (!p) throw new Error(t("registry.unknownBackend", id));
  return p;
}
