import { Fragment, useCallback, useEffect, useState } from "react";
import { HotkeyRecorder } from "../../components/HotkeyRecorder";
import { Icon } from "../../components/Icon";
import { KeyCombo } from "../../components/Keycap";
import { displayKeys, getHotkeys, setHotkey, type HotkeyAction, type HotkeyConfig } from "../../lib/hotkeys";
import { tryLauncher } from "../../lib/onboarding";
import { NavButtons, Page, type StepProps } from "../Onboarding";

const ROWS: { id: HotkeyAction; title: (c: HotkeyConfig) => string }[] = [
  { id: "voice", title: (c) => (c.voiceMode === "hold" ? "Talk to search (hold)" : "Talk to search (press)") },
  { id: "ask", title: () => "Ask a question" },
  { id: "selection", title: () => "Search selected text" },
];

export function ShortcutsStep({ next, back }: StepProps) {
  const [keys, setKeys] = useState<HotkeyConfig | null>(null);
  const [unavailable, setUnavailable] = useState<HotkeyAction[]>([]);
  const [recording, setRecording] = useState<HotkeyAction | null>(null);

  useEffect(() => {
    getHotkeys()
      .then((s) => {
        setKeys(s.config);
        setUnavailable(s.unavailable);
      })
      .catch(() => {});
  }, []);

  const cancel = useCallback(() => setRecording(null), []);

  const save = async (action: HotkeyAction, accelerator: string) => {
    setKeys(await setHotkey(action, accelerator));
    setUnavailable((u) => u.filter((a) => a !== action));
    setRecording(null);
  };

  const main = keys ? displayKeys(keys.launcher) : [];
  const mainTaken = unavailable.includes("launcher");

  return (
    <Page footer={<NavButtons back={back} next={next} disabled={recording !== null} />}>
      <h1 className="setup-title">One shortcut, from any app</h1>
      <p className="setup-lede">Press it now to try. The search box opens over whatever you're doing.</p>

      <div className="panel try-keys">
        {recording === "launcher" ? (
          <HotkeyRecorder onSave={(acc) => save("launcher", acc)} onCancel={cancel} />
        ) : (
          <>
            <span className="try-combo" aria-label={main.join(" + ")}>
              {main.map((k, i) => (
                <Fragment key={k}>
                  {i > 0 && <span className="try-plus muted">+</span>}
                  <kbd className={`kbd big${k === "Space" ? " wide" : ""}`}>{k}</kbd>
                </Fragment>
              ))}
            </span>
            {mainTaken ? (
              <button type="button" className="btn try-btn" onClick={() => setRecording("launcher")}>
                Pick other keys
              </button>
            ) : (
              <button type="button" className="btn try-btn" onClick={() => tryLauncher().catch(() => {})}>
                Try it now
              </button>
            )}
          </>
        )}
      </div>
      {mainTaken && recording !== "launcher" && (
        <div className="infobar error" role="alert">
          <Icon name="error" size={16} />
          <span className="grow">Another app is using {main.join(" + ")}. Pick other keys to open search.</span>
        </div>
      )}

      <div className="stack">
        {keys &&
          ROWS.map((r) => (
            <div key={r.id} className={`card tight shortcut-row${recording === r.id ? " recording" : ""}`}>
              <Icon name="keyboard" size={20} className="k-code kc" />
              <span className="grow">
                <span className="t">{r.title(keys)}</span>
                {unavailable.includes(r.id) && (
                  <span className="s" style={{ color: "var(--danger)" }}>
                    Another app is using these keys. Pick different ones.
                  </span>
                )}
              </span>
              {recording === r.id ? (
                <HotkeyRecorder onSave={(acc) => save(r.id, acc)} onCancel={cancel} />
              ) : (
                <>
                  <KeyCombo accelerator={keys[r.id]} />
                  <button type="button" className="btn" disabled={recording !== null} onClick={() => setRecording(r.id)}>
                    Change
                  </button>
                </>
              )}
            </div>
          ))}
      </div>
    </Page>
  );
}
