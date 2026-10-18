import { useCallback, useEffect, useState } from "react";
import { HotkeyRecorder } from "../../components/HotkeyRecorder";
import { KeyCombo } from "../../components/Keycap";
import { Segmented } from "../../components/Toggle";
import {
  ACTIONS,
  getHotkeys,
  setHotkey,
  setVoiceOptions,
  type HotkeyAction,
  type HotkeyConfig,
  type VoiceMode,
} from "../../lib/hotkeys";
import { tryLauncher } from "../../lib/onboarding";
import { StepFooter, StepHeader, type StepProps } from "../Onboarding";

export function ShortcutsStep({ next, back }: StepProps) {
  const [config, setConfig] = useState<HotkeyConfig | null>(null);
  const [unavailable, setUnavailable] = useState<HotkeyAction[]>([]);
  const [recording, setRecording] = useState<HotkeyAction | null>(null);

  useEffect(() => {
    getHotkeys().then((s) => {
      setConfig(s.config);
      setUnavailable(s.unavailable);
    });
  }, []);

  const cancel = useCallback(() => setRecording(null), []);

  if (!config) return null;

  const save = async (action: HotkeyAction, accelerator: string) => {
    setConfig(await setHotkey(action, accelerator));
    setUnavailable((u) => u.filter((a) => a !== action));
    setRecording(null);
  };

  const setMode = async (mode: VoiceMode) => setConfig(await setVoiceOptions(mode, config.autoSubmit));

  const [main, ...rest] = ACTIONS;

  return (
    <>
      <StepHeader
        title="Search from anywhere"
        lead="These shortcuts work in every app, even full screen. Keep the defaults or press Change to pick your own."
      />

      <section className="ob-card ob-try">
        <span className="ob-row-text">
          <span className="ob-muted">{main.label}</span>
          <span className="ob-try-keys">
            <KeyCombo accelerator={config[main.id]} />
          </span>
          {unavailable.includes(main.id) ? (
            <span className="ob-error">Another app is using this shortcut. Pick a different one.</span>
          ) : (
            <span className="ob-muted">Try it now: press it, search for something, then press Esc to come back here.</span>
          )}
        </span>
        <div className="ob-callout-actions">
          {recording === main.id ? (
            <HotkeyRecorder onSave={(acc) => save(main.id, acc)} onCancel={cancel} />
          ) : (
            <>
              <button type="button" className="ob-btn" disabled={recording !== null} onClick={() => setRecording(main.id)}>
                Change
              </button>
              <button type="button" className="ob-btn ob-btn-accent" onClick={() => tryLauncher()}>
                Open it
              </button>
            </>
          )}
        </div>
      </section>

      <ul className="ob-card ob-list">
        {rest.map((a) => (
          <li key={a.id} className="ob-row">
            <span className="ob-row-text">
              <span className="ob-row-title">{a.label}</span>
              <span className="ob-muted">{a.hint(config.voiceMode)}</span>
              {unavailable.includes(a.id) && <span className="ob-error">Another app is using this shortcut. Pick a different one.</span>}
            </span>
            {recording === a.id ? (
              <HotkeyRecorder onSave={(acc) => save(a.id, acc)} onCancel={cancel} />
            ) : (
              <span className="ob-hotkey">
                <KeyCombo accelerator={config[a.id]} />
                <button type="button" className="ob-btn" disabled={recording !== null} onClick={() => setRecording(a.id)}>
                  Change
                </button>
              </span>
            )}
          </li>
        ))}
        <li className="ob-row">
          <span className="ob-row-text">
            <span className="ob-row-title">Voice key</span>
            <span className="ob-muted">How the voice shortcut listens</span>
          </span>
          <Segmented
            label="Voice key mode"
            value={config.voiceMode}
            onChange={setMode}
            options={[
              { value: "hold", label: "Hold to talk" },
              { value: "toggle", label: "Press to start / stop" },
            ]}
          />
        </li>
      </ul>

      <StepFooter back={back}>
        <button type="button" className="ob-btn ob-btn-accent" disabled={recording !== null} onClick={next}>
          Next
        </button>
      </StepFooter>
    </>
  );
}
