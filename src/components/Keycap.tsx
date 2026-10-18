import { displayKeys } from "../lib/hotkeys";
import "./controls.css";

export function Keycap({ children, small }: { children: string; small?: boolean }) {
  return <kbd className={small ? "keycap keycap-small" : "keycap"}>{children}</kbd>;
}

export function KeyCombo({ accelerator, small }: { accelerator: string; small?: boolean }) {
  return (
    <span className="key-combo" aria-label={displayKeys(accelerator).join(" + ")}>
      {displayKeys(accelerator).map((k) => (
        <Keycap key={k} small={small}>
          {k}
        </Keycap>
      ))}
    </span>
  );
}
