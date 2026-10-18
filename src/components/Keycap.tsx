import { displayKeys } from "../lib/hotkeys";
import "./controls.css";

export function Keys({ keys, big }: { keys: string[]; big?: boolean }) {
  return (
    <span className="keys" aria-label={keys.join(" + ")}>
      {keys.map((k) => (
        <kbd key={k} className={big ? "kbd big" : "kbd"}>
          {k}
        </kbd>
      ))}
    </span>
  );
}

/** A shortcut as keycaps: "Super+Shift+F" shows Win, Shift, F. */
export function KeyCombo({ accelerator, big }: { accelerator: string; big?: boolean }) {
  return <Keys keys={displayKeys(accelerator)} big={big} />;
}
