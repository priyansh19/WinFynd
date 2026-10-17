import { displayKeys } from "../lib/hotkeys";
import "./controls.css";

export function Keycap({ children }: { children: string }) {
  return <kbd className="keycap">{children}</kbd>;
}

export function KeyCombo({ accelerator }: { accelerator: string }) {
  return (
    <span className="key-combo">
      {displayKeys(accelerator).map((k) => (
        <Keycap key={k}>{k}</Keycap>
      ))}
    </span>
  );
}
