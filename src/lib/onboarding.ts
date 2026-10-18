// First-run setup window: closing the flow and the few actions only it needs.
import { invoke, stubCommands } from "./tauri";

/** Where to go when setup closes. */
export type AfterSetup = "launcher" | "control" | "tray";

export const finishOnboarding = (then: AfterSetup) => invoke<void>("finish_onboarding", { then });
export const openOllamaDownload = () => invoke<void>("open_ollama_download");
/** Show the launcher without closing setup; with `query`, typed in for the user (and asked, with `ask`). */
export const tryLauncher = (query?: string, ask = false) => invoke<void>("try_launcher", { query: query ?? null, ask });
/** Send the "WinFynd is ready" notification when the first full index finishes, even with setup still open. */
export const watchFirstIndex = () => invoke<void>("watch_first_index");

const DONE_KEY = "wf.setupDone";

/** True once setup has been finished on this PC, so running it again keeps the user's choices. */
export function setupDoneBefore(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markSetupDone() {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    // Only affects which folders start ticked next time.
  }
}

stubCommands({
  finish_onboarding: () => undefined,
  open_ollama_download: () => undefined,
  try_launcher: () => undefined,
  watch_first_index: () => undefined,
});
