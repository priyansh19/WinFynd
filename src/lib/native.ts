// Makes the web view behave like a Windows app: the user's accent colour and
// the system backdrop from the Rust side, Explorer's own file icons, and none
// of the browser's menus and shortcuts.
import { useEffect, useState } from "react";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { inTauri, invoke, listen } from "./tauri";

interface Appearance {
  /** Accent shades, lightest first; empty when Windows doesn't say. */
  accent: string[];
  backdrop: "mica" | "acrylic" | "none";
}

/** Windows' own default accent: treated as "not picked", so the design's blue shows. */
const WINDOWS_DEFAULT = "#0078d4";

async function applyAppearance() {
  if (!inTauri) return;
  try {
    const a = await invoke<Appearance>("appearance");
    const root = document.documentElement;
    root.dataset.backdrop = a.backdrop;
    // Like WinUI: Light 2 on dark backgrounds, Dark 1 on light ones.
    const picked = a.accent.length === 7 && a.accent[3].toLowerCase() !== WINDOWS_DEFAULT;
    if (picked) {
      root.style.setProperty("--sys-accent-dark", a.accent[1]);
      root.style.setProperty("--sys-accent-light", a.accent[4]);
    } else {
      root.style.removeProperty("--sys-accent-dark");
      root.style.removeProperty("--sys-accent-light");
    }
  } catch {
    // Keep the design's blue and the solid background.
  }
}

/** Browser shortcuts that mean nothing in an app window: reload, print, find, save, history, caret browsing, back/forward. */
function isBrowserShortcut(e: KeyboardEvent) {
  if (e.key === "F3" || e.key === "F5" || e.key === "F7") return true;
  if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return true;
  return e.ctrlKey && !e.altKey && ["f", "g", "h", "j", "n", "o", "p", "r", "s", "u"].includes(e.key.toLowerCase());
}

export function initNativeWindow() {
  applyAppearance();
  listen("appearance://changed", applyAppearance);
  // The accent can change without a theme change; pick it up whenever the window comes back.
  window.addEventListener("focus", applyAppearance);

  if (import.meta.env.DEV) return;
  document.addEventListener("contextmenu", (e) => {
    // Text fields keep their Cut/Copy/Paste menu; everything else has the app's own.
    if (!(e.target as Element).closest("input, textarea")) e.preventDefault();
  });
  document.addEventListener("keydown", (e) => {
    if (isBrowserShortcut(e)) e.preventDefault();
  });
}

// Explorer icons are the same for every file of a type, so they're cached by
// extension; these types carry their own icon per file.
const OWN_ICON = /\.(exe|lnk|ico|url|appref-ms|msc|cpl|scr)$/i;
const cache = new Map<string, Promise<string | null>>();

function shellImage(path: string, size: number, thumbnail: boolean): Promise<string | null> {
  const ext = path.match(/\.[^.\\/]+$/)?.[0]?.toLowerCase() ?? "";
  const key = thumbnail ? `t${size}|${path}` : `i${size}|${OWN_ICON.test(path) || !ext ? path : ext}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = invoke<string>("shell_image", { path, size, thumbnail }).catch(() => null);
    cache.set(key, hit);
    if (cache.size > 400) cache.delete(cache.keys().next().value!);
  }
  return hit;
}

/**
 * The icon Explorer shows for a file, or with `thumbnail` its thumbnail
 * (documents, videos, photos), as an image URL; null until loaded or outside
 * the desktop app, so callers show a generic icon meanwhile.
 */
export function useShellImage(path: string, size: number, thumbnail = false): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!inTauri) return;
    let live = true;
    setUrl(null);
    shellImage(path, Math.round(size * window.devicePixelRatio), thumbnail).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [path, size, thumbnail]);
  return url;
}

/**
 * Keep a borderless window exactly as tall as its content, so the launcher is
 * just a search box until there are results to show.
 */
export function useFitWindowHeight(ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !inTauri) return;
    let last = 0;
    const fit = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      if (!height || height === last) return;
      last = height;
      getCurrentWindow().setSize(new LogicalSize(window.innerWidth, height)).catch(() => {});
    };
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}

/** A Windows message box asking to confirm; window.confirm in the browser preview. */
export async function confirmNative(message: string, title: string, okLabel: string): Promise<boolean> {
  if (!inTauri) return window.confirm(message);
  return ask(message, { title, kind: "warning", okLabel, cancelLabel: "Cancel" });
}
