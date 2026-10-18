import { useCallback, useEffect, useState } from "react";
import { HotkeyRecorder } from "../../components/HotkeyRecorder";
import { Icon, type IconName } from "../../components/Icon";
import { KeyCombo } from "../../components/Keycap";
import { SettingsCard } from "../../components/SettingsCard";
import { ComboBox, Toggle } from "../../components/Toggle";
import {
  ACTIONS,
  getHotkeys,
  setHotkey,
  setVoiceOptions,
  type HotkeyAction,
  type HotkeyConfig,
  type VoiceMode,
} from "../../lib/hotkeys";

const ACTION_ICON: Record<HotkeyAction, IconName> = {
  launcher: "search",
  voice: "mic",
  ask: "ask",
  selection: "copy",
};

export function HotkeysPage() {
  const [config, setConfig] = useState<HotkeyConfig | null>(null);
  const [unavailable, setUnavailable] = useState<HotkeyAction[]>([]);
  const [recording, setRecording] = useState<HotkeyAction | null>(null);

  const refresh = useCallback(() => {
    getHotkeys().then((s) => {
      setConfig(s.config);
      setUnavailable(s.unavailable);
    });
  }, []);
  useEffect(refresh, [refresh]);

  const cancel = useCallback(() => setRecording(null), []);

  if (!config) return null;

  const save = async (action: HotkeyAction, accelerator: string) => {
    setConfig(await setHotkey(action, accelerator));
    setUnavailable((u) => u.filter((a) => a !== action));
    setRecording(null);
  };

  const updateVoice = async (voiceMode: VoiceMode, autoSubmit: boolean) => {
    setConfig(await setVoiceOptions(voiceMode, autoSubmit));
  };

  return (
    <div className="cc-page-inner">
      <h1 className="cc-title">Hotkeys &amp; voice</h1>
      <p className="cc-lead">Shortcuts work everywhere in Windows, even over full-screen apps.</p>

      <h2 className="cc-section">Shortcuts</h2>
      <div className="cc-stack">
        {ACTIONS.map((a) => (
          <SettingsCard
            key={a.id}
            icon={ACTION_ICON[a.id]}
            header={a.label}
            className={recording === a.id ? "is-recording" : undefined}
            description={
              unavailable.includes(a.id) ? (
                <span className="is-error">Another app is using this shortcut. Pick a different one.</span>
              ) : (
                a.hint(config.voiceMode)
              )
            }
          >
            {recording === a.id ? (
              <HotkeyRecorder onSave={(acc) => save(a.id, acc)} onCancel={cancel} />
            ) : (
              <div className="hotkey-current">
                <KeyCombo accelerator={config[a.id]} />
                <button
                  type="button"
                  className="btn btn-subtle btn-icon"
                  aria-label={`Change shortcut for ${a.label}`}
                  title="Change shortcut"
                  disabled={recording !== null}
                  onClick={() => setRecording(a.id)}
                >
                  <Icon name="edit" size={16} />
                </button>
              </div>
            )}
          </SettingsCard>
        ))}
      </div>

      <h2 className="cc-section">Voice input</h2>
      <div className="cc-stack">
        <SettingsCard
          icon="speech"
          header="How the voice key works"
          description={
            config.voiceMode === "hold"
              ? "Hold the voice key while you speak, like a walkie-talkie."
              : "Tap the voice key to start listening, and tap it again to stop."
          }
        >
          <ComboBox
            label="How the voice key works"
            value={config.voiceMode}
            onChange={(m) => updateVoice(m, config.autoSubmit)}
            options={[
              { value: "hold", label: "Hold to talk" },
              { value: "toggle", label: "Press to start and stop" },
            ]}
          />
        </SettingsCard>
        <SettingsCard
          icon="search"
          header="Search when I stop talking"
          description="Off means you can check the words before searching."
        >
          <Toggle
            label="Search when I stop talking"
            checked={config.autoSubmit}
            onChange={(v) => updateVoice(config.voiceMode, v)}
          />
        </SettingsCard>
      </div>
    </div>
  );
}
