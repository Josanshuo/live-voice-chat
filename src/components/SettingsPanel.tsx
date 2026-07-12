import { useEffect, useRef, useState } from "react";
import { providers } from "../lib/live/registry";
import { t } from "../lib/i18n";

export interface Settings {
  providerId: string;
  model: string;
  voice: string;
  instructions: string;
  apiKey: string;
}

// Custom dropdown instead of a native <select>: embedded browsers often
// can't open native dropdown popups, and this stays styleable and testable
// everywhere. Closes on outside click or Escape.
// Exported for unit tests.
export function Dropdown({
  options,
  value,
  onSelect,
  disabled,
}: {
  options: { id: string; label: string }[];
  value: string;
  onSelect: (id: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.id === value);

  return (
    <div className="dropdown" ref={rootRef}>
      <button
        type="button"
        className="dropdown-btn"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="dropdown-label">{current?.label ?? value}</span>
        <span className={`dropdown-caret ${open ? "dropdown-caret-open" : ""}`}>
          ▾
        </span>
      </button>
      {open && (
        <div className="dropdown-menu" role="listbox">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === value}
              className={`dropdown-option ${
                o.id === value ? "dropdown-option-selected" : ""
              }`}
              onClick={() => {
                onSelect(o.id);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Chip picker for voices: every option stays visible and tappable, which
// suits the click-to-preview interaction.
function ChipGroup({
  options,
  value,
  onSelect,
  disabled,
  wrap = false,
}: {
  options: { id: string; label: string }[];
  value: string;
  onSelect: (id: string) => void;
  disabled: boolean;
  wrap?: boolean;
}) {
  return (
    <div className={`chips ${wrap ? "chips-wrap" : ""}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          className={`chip ${o.id === value ? "chip-selected" : ""}`}
          disabled={disabled}
          onClick={() => onSelect(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function SettingsPanel({
  settings,
  onChange,
  disabled,
  hasServerKey,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  disabled: boolean;
  hasServerKey: boolean;
}) {
  const provider = providers.find((p) => p.id === settings.providerId)!;

  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });

  // Voice preview: picking a voice also plays its pre-generated sample
  // (a static MP3, cached by the browser like any other asset).
  const [previewing, setPreviewing] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => previewAudioRef.current?.pause();
  }, []);

  const previewVoice = async (voice: string) => {
    if (!provider.voicePreviewUrl) return;
    setPreviewing(voice);
    try {
      if (!previewAudioRef.current) previewAudioRef.current = new Audio();
      const audio = previewAudioRef.current;
      audio.pause();
      audio.src = provider.voicePreviewUrl(voice);
      audio.onended = () => setPreviewing((v) => (v === voice ? null : v));
      await audio.play();
    } catch (err) {
      console.warn("voice preview failed:", err);
      setPreviewing((v) => (v === voice ? null : v));
    }
  };

  // One picker for backend + model: every backend contributes its tiers.
  const modelOptions = providers.flatMap((p) =>
    p.models.map((m) => ({
      id: `${p.id}::${m.id}`,
      label: providers.length > 1 ? `${p.label} · ${m.label}` : m.label,
    }))
  );

  return (
    <div className="settings">
      {disabled && (
        <div className="settings-lock">
          {t("settings.locked")}
        </div>
      )}

      <div className="field">
        <span className="field-name">{t("settings.model")}</span>
        <Dropdown
          options={modelOptions}
          value={`${settings.providerId}::${settings.model}`}
          disabled={disabled}
          onSelect={(id) => {
            const [providerId, model] = id.split("::");
            const p = providers.find((x) => x.id === providerId)!;
            set({
              providerId,
              model,
              // keep the voice across tiers of the same backend, reset
              // when the new backend doesn't offer it
              voice: p.voices.includes(settings.voice)
                ? settings.voice
                : p.defaultVoice,
            });
          }}
        />
      </div>

      <div className="field">
        <span className="field-name">
          {t("settings.voice")}
          {provider.voicePreviewUrl ? t("settings.voicePreviewHint") : ""}
        </span>
        <ChipGroup
          wrap
          options={provider.voices.map((v) => ({
            id: v,
            label: v === previewing ? `${v} ♪` : v,
          }))}
          value={settings.voice}
          disabled={disabled}
          onSelect={(id) => {
            set({ voice: id });
            previewVoice(id);
          }}
        />
      </div>

      <label className="field">
        <span className="field-name">{t("settings.instructions")}</span>
        <textarea
          rows={3}
          placeholder={t("settings.instructionsPlaceholder")}
          value={settings.instructions}
          disabled={disabled}
          onChange={(e) => set({ instructions: e.target.value })}
        />
      </label>

      {!hasServerKey && (
        <label className="field">
          <span className="field-name">OpenAI API Key</span>
          <input
            type="password"
            placeholder={t("settings.apiKeyPlaceholder")}
            value={settings.apiKey}
            disabled={disabled}
            onChange={(e) => set({ apiKey: e.target.value })}
          />
          <small>{t("settings.apiKeyNote")}</small>
        </label>
      )}
    </div>
  );
}
