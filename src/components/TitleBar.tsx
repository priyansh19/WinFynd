import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { inTauri } from "../lib/tauri";
import { AppIcon, Icon } from "./Icon";
import "./controls.css";

/**
 * Caption buttons for a window that draws its own title bar, so the page's
 * background runs up behind them like Mica does in Windows 11 apps. The
 * empty space drags the window; double-clicking it maximizes.
 */
export function Caps({ maximizable = true }: { maximizable?: boolean }) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!inTauri) return;
    const w = getCurrentWindow();
    const sync = () => w.isMaximized().then(setMaximized).catch(() => {});
    sync();
    const off = w.onResized(sync);
    return () => {
      off.then((f) => f());
    };
  }, []);
  const w = () => (inTauri ? getCurrentWindow() : null);
  return (
    <div className="caps">
      <button type="button" className="cap" aria-label="Minimize" title="Minimize" onClick={() => w()?.minimize()}>
        <Icon name="minimize" size={16} strokeWidth={1} />
      </button>
      <button
        type="button"
        className="cap"
        aria-label={maximized ? "Restore" : "Maximize"}
        title={maximized ? "Restore" : "Maximize"}
        disabled={!maximizable}
        onClick={() => w()?.toggleMaximize()}
      >
        <Icon name={maximized ? "restore" : "maximize"} size={16} strokeWidth={1} />
      </button>
      <button type="button" className="cap close" aria-label="Close" title="Close" onClick={() => w()?.close()}>
        <Icon name="close" size={16} strokeWidth={1} />
      </button>
    </div>
  );
}

/** A 48 px title bar with the app icon and title on the left. */
export function TitleBar({ title }: { title: string }) {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <AppIcon size={18} />
      <span data-tauri-drag-region>{title}</span>
      <Caps />
    </header>
  );
}
