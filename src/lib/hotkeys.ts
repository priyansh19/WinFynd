import { invoke, stubCommands } from "./tauri";

export type HotkeyAction = "launcher" | "voice" | "ask" | "selection";
export type VoiceMode = "hold" | "toggle";

export interface HotkeyConfig {
  launcher: string;
  voice: string;
  ask: string;
  selection: string;
  voiceMode: VoiceMode;
  autoSubmit: boolean;
}

export interface HotkeySnapshot {
  config: HotkeyConfig;
  unavailable: HotkeyAction[];
}

export const ACTIONS: { id: HotkeyAction; label: string; hint: (mode: VoiceMode) => string }[] = [
  { id: "launcher", label: "Open the launcher", hint: () => "Shows the floating search window over any app" },
  {
    id: "voice",
    label: "Voice search",
    hint: (mode) => (mode === "hold" ? "Hold to speak, release to search" : "Press once to start, again to stop"),
  },
  { id: "ask", label: "Ask a question", hint: () => "Opens the launcher in answer mode, using your files as sources" },
  { id: "selection", label: "Search selected text", hint: () => "Finds files related to whatever is highlighted" },
];

const MODIFIER_CODES = new Set([
  "ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight",
]);

/** Key name as the Tauri global-shortcut parser expects it, from a DOM `code`. */
function keyFromCode(code: string): string | null {
  if (MODIFIER_CODES.has(code)) return null;
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  const named: Record<string, string> = {
    Space: "Space", Enter: "Enter", Tab: "Tab", Backquote: "Backquote", Minus: "Minus", Equal: "Equal",
    BracketLeft: "BracketLeft", BracketRight: "BracketRight", Backslash: "Backslash", Semicolon: "Semicolon",
    Quote: "Quote", Comma: "Comma", Period: "Period", Slash: "Slash", Insert: "Insert", Delete: "Delete",
    Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
    ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
  };
  return named[code] ?? null;
}

export interface Captured {
  /** Keys held so far, for live display. */
  parts: string[];
  /** A complete accelerator, once a non-modifier key is pressed. */
  accelerator: string | null;
}

/** Turn a keydown into the combo being recorded. */
export function captureCombo(e: KeyboardEvent): Captured {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");
  const key = keyFromCode(e.code);
  if (!key) return { parts, accelerator: null };
  parts.push(key);
  // Global hotkeys need at least one modifier, except function keys.
  const ok = parts.length > 1 || /^F\d{1,2}$/.test(key);
  return { parts, accelerator: ok ? parts.join("+") : null };
}

/** "Super+Shift+F" -> ["Win", "Shift", "F"] for keycaps. */
export function displayKeys(accelerator: string): string[] {
  return accelerator.split("+").map((k) => (k === "Super" ? "Win" : k === "Backquote" ? "`" : k));
}

/** Combos Windows or common apps already use, worth a warning before saving. */
export function knownConflict(accelerator: string): string | null {
  const known: Record<string, string> = {
    "Alt+Space": "Windows uses Alt+Space for the window menu. WinFynd takes it over while running.",
    "Ctrl+Shift+Space": "Some keyboard layouts and IMEs use Ctrl+Shift+Space.",
    "Super+Space": "Windows uses Win+Space to switch input language.",
    "Ctrl+Alt+Delete": "Windows reserves Ctrl+Alt+Delete.",
    "Super+L": "Windows reserves Win+L to lock the PC.",
  };
  return known[accelerator] ?? null;
}

export const getHotkeys = () => invoke<HotkeySnapshot>("get_hotkeys");
export const setHotkey = (action: HotkeyAction, accelerator: string) =>
  invoke<HotkeyConfig>("set_hotkey", { action, accelerator });
export const setVoiceOptions = (voiceMode: VoiceMode, autoSubmit: boolean) =>
  invoke<HotkeyConfig>("set_voice_options", { voiceMode, autoSubmit });
export const suspendHotkeys = (suspended: boolean) => invoke<void>("suspend_hotkeys", { suspended });

// Browser preview: keep hotkeys in memory.
let preview: HotkeyConfig = {
  launcher: "Alt+Space", voice: "Alt+Shift+Space", ask: "Ctrl+Alt+Space", selection: "Super+Shift+F",
  voiceMode: "hold", autoSubmit: true,
};
stubCommands({
  get_hotkeys: () => ({ config: preview, unavailable: [] }),
  set_hotkey: ({ action, accelerator }) => {
    const taken = ACTIONS.find((a) => a.id !== action && preview[a.id] === accelerator);
    if (taken) throw `${accelerator} is already used by another WinFynd action`;
    preview = { ...preview, [action as HotkeyAction]: accelerator as string };
    return preview;
  },
  set_voice_options: ({ voiceMode, autoSubmit }) => {
    preview = { ...preview, voiceMode: voiceMode as VoiceMode, autoSubmit: autoSubmit as boolean };
    return preview;
  },
  suspend_hotkeys: () => undefined,
  hide_launcher_cmd: () => undefined,
  open_control_center: () => undefined,
});
