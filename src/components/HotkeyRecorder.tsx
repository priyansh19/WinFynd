import { useEffect, useRef, useState } from "react";
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
  const saveRef = useRef<() => void>(() => {});

  // Hotkeys stay released only while this window has focus. Closing the window
  // just hides it, so recording would otherwise leave them off everywhere.
  useEffect(() => {
    const suspend = () => suspendHotkeys(true).catch(() => {});
    const resume = () => suspendHotkeys(false).catch(() => {});
    suspend();
    window.addEventListener("focus", suspend);
    window.addEventListener("blur", resume);
    return () => {
      window.removeEventListener("focus", suspend);
      window.removeEventListener("blur", resume);
      resume();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const plain = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
      const onButton = e.target instanceof HTMLButtonElement;
      // Either Enter key, the main one or the keypad's.
      const enter = e.key === "Enter";
      // Tab and Shift+Tab move between Save and Cancel.
      const tab = e.code === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey;
      // Tab, Space and Enter can't be shortcuts. Space and Enter press a
      // focused button, and Enter anywhere else saves.
      if (tab || (plain && onButton && (e.code === "Space" || enter))) return;
      e.preventDefault();
      e.stopPropagation();
      if (plain && e.code === "Escape") onCancel();
      else if (plain && enter) saveRef.current();
      else if (!(plain && e.code === "Space")) {
        const captured = captureCombo(e);
        setParts(captured.parts);
        setError(null);
        setCombo(captured.accelerator);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
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
  saveRef.current = save;

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
