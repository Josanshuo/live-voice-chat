import { providers } from "../lib/live/registry";

export interface Settings {
  providerId: string;
  model: string;
  voice: string;
  instructions: string;
  apiKey: string;
}

// Custom chip pickers instead of native <select>: embedded browsers often
// can't open native dropdown popups, and chips give an obvious
// selected/disabled state on touch screens.
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
          通话中无法更改设置，结束通话后即可修改
        </div>
      )}

      <div className="field">
        <span className="field-name">模型</span>
        <ChipGroup
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
        <span className="field-name">声音</span>
        <ChipGroup
          wrap
          options={provider.voices.map((v) => ({ id: v, label: v }))}
          value={settings.voice}
          disabled={disabled}
          onSelect={(id) => set({ voice: id })}
        />
      </div>

      <label className="field">
        <span className="field-name">系统指令（可选）</span>
        <textarea
          rows={3}
          placeholder="例如：你是一个友善的中文语音助手，回答尽量简短。"
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
            placeholder="sk-...（服务器未配置 .env 时填写）"
            value={settings.apiKey}
            disabled={disabled}
            onChange={(e) => set({ apiKey: e.target.value })}
          />
          <small>
            仅保存在本机浏览器 localStorage，并只发送给本地 token 服务。
            推荐改用项目根目录 .env 配置 OPENAI_API_KEY。
          </small>
        </label>
      )}
    </div>
  );
}
