// First-run setup window: closing the flow and the few actions only it needs.
import { invoke, stubCommands } from "./tauri";

/** Where to go when setup closes. */
export type AfterSetup = "launcher" | "control" | "tray";

export const finishOnboarding = (then: AfterSetup) => invoke<void>("finish_onboarding", { then });
export const openOllamaDownload = () => invoke<void>("open_ollama_download");
export const tryLauncher = () => invoke<void>("try_launcher");

stubCommands({
  finish_onboarding: () => undefined,
  open_ollama_download: () => undefined,
  try_launcher: () => undefined,
});
