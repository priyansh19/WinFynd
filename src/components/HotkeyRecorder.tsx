import { useEffect, useState } from "react";
import { captureCombo, displayKeys, knownConflict, suspendHotkeys } from "../lib/hotkeys";
import "./controls.css";

/**
 * Captures the next key combo, inline in its card: "Press the new shortcut",
 * the keys held so far, then Cancel or Save. Global hotkeys are released
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
      e.stopPropagation();
      if (e.code === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        onCancel();
        return;
      }
      if (e.code === "Enter" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return;
      const captured = captureCombo(e);
      setParts(captured.parts);
      setError(null);
      setCombo(captured.accelerator);
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
    <div className="recorder" aria-live="polite">
      {warning ? (
        <span className={error ? "recorder-note error" : "recorder-note"}>{warning}</span>
      ) : (
        <span className="recorder-label">{combo ? "Save to use it" : "Press the new shortcut"}</span>
      )}
      <span className="keys">
        {shown.map((k) => (
          <kbd key={k} className="kbd live">
            {k}
          </kbd>
        ))}
        {!combo && <kbd className="kbd">…</kbd>}
      </span>
      {combo && (
        <button type="button" className="btn accent" onClick={save}>
          Save
        </button>
      )}
      <button type="button" className="btn" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
