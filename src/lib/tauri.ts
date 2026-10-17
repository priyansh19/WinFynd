// Thin wrapper over the Tauri bridge so the UI also runs in a plain browser
// (`npm run dev`) with stubbed responses while designing.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;
let browserStubs: Handlers = {};

/** Register fallbacks used when running outside Tauri. */
export function stubCommands(handlers: Handlers) {
  browserStubs = { ...browserStubs, ...handlers };
}

export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (inTauri) return tauriInvoke<T>(cmd, args);
  const stub = browserStubs[cmd];
  if (!stub) throw new Error(`No browser stub for ${cmd}`);
  return stub(args) as T;
}

export async function listen(event: string, handler: () => void): Promise<UnlistenFn> {
  if (!inTauri) return () => {};
  return tauriListen(event, handler);
}
