import { useCallback, useEffect, useState } from "react";
import { HotkeyRecorder } from "../../components/HotkeyRecorder";
import { KeyCombo } from "../../components/Keycap";
import { Segmented, Toggle } from "../../components/Toggle";
import {
  ACTIONS,
  getHotkeys,
  setHotkey,
  setVoiceOptions,
  type HotkeyAction,
  type HotkeyConfig,
  type VoiceMode,
} from "../../lib/hotkeys";

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
    <>
      <header className="cc-header">
        <h1>Hotkeys &amp; voice</h1>
        <p>Click Change, then press the keys you want. Hotkeys work everywhere in Windows, even in full-screen apps.</p>
      </header>

      <div className="card list">
        {ACTIONS.map((a) => (
          <div key={a.id} className={`list-row ${recording === a.id ? "is-recording" : ""}`}>
            <div className="list-text">
              <span className="list-title">{a.label}</span>
              <span className="cc-muted">{a.hint(config.voiceMode)}</span>
              {unavailable.includes(a.id) && (
                <span className="text-danger">Another app is using this combo. Pick a different one.</span>
              )}
            </div>
            {recording === a.id ? (
              <HotkeyRecorder onSave={(acc) => save(a.id, acc)} onCancel={cancel} />
            ) : (
              <div className="hotkey-current">
                <KeyCombo accelerator={config[a.id]} />
                <button type="button" className="btn" disabled={recording !== null} onClick={() => setRecording(a.id)}>
                  Change
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <h2 className="cc-subhead">Voice input</h2>
      <div className="card list">
        <div className="list-row">
          <div className="list-text">
            <span className="list-title">How the voice key works</span>
            <span className="cc-muted">
              {config.voiceMode === "hold"
                ? "Hold the voice key while you speak, like a walkie-talkie"
                : "Tap the voice key to start listening, tap again to stop"}
            </span>
          </div>
          <Segmented
            label="Voice key mode"
            value={config.voiceMode}
            onChange={(m) => updateVoice(m, config.autoSubmit)}
            options={[
              { value: "hold", label: "Hold to talk" },
              { value: "toggle", label: "Press to start / stop" },
            ]}
          />
        </div>
        <div className="list-row">
          <div className="list-text">
            <span className="list-title">Search automatically when I stop talking</span>
            <span className="cc-muted">Off means you review the text first.</span>
          </div>
          <Toggle
            label="Search automatically when I stop talking"
            checked={config.autoSubmit}
            onChange={(v) => updateVoice(config.voiceMode, v)}
          />
        </div>
      </div>
    </>
  );
}
