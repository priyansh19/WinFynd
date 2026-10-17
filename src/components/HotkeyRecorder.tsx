import { useEffect, useState } from "react";
import { captureCombo, displayKeys, knownConflict, suspendHotkeys } from "../lib/hotkeys";
import { Keycap } from "./Keycap";
import "./controls.css";

/**
 * Captures the next key combo the user presses. Global hotkeys are released
 * while recording so pressing an existing combo reaches this field.
 */
export function HotkeyRecorder({
  onSave,
  onCancel,
}: {
  onSave: (accelerator: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [parts, setParts] = useState<string[]>([]);
  const [combo, setCombo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    suspendHotkeys(true).catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        onCancel();
        return;
      }
      const captured = captureCombo(e);
      setParts(captured.parts);
      setError(null);
      if (captured.accelerator) setCombo(captured.accelerator);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      suspendHotkeys(false).catch(() => {});
    };
  }, [onCancel]);

  const shown = combo ? displayKeys(combo) : parts.map((p) => (p === "Super" ? "Win" : p));
  const warning = error ?? (combo ? knownConflict(combo) : null);

  const save = async () => {
    if (!combo) return;
    try {
      await onSave(combo);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="recorder">
      <div className="recorder-field" aria-live="polite">
        <span className="recorder-dot" aria-hidden="true" />
        <span className="recorder-label">{shown.length ? "Recording" : "Press keys…"}</span>
        {shown.map((k) => (
          <Keycap key={k}>{k}</Keycap>
        ))}
      </div>
      <div className="recorder-actions">
        {warning && <span className={error ? "recorder-error" : "recorder-warning"}>{warning}</span>}
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={!combo} onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
