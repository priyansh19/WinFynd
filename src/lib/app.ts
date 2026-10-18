// The app itself: its version, its own web pages, setup, and the once-a-day
// check for a newer release (the only time WinFynd contacts GitHub).
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { inTauri, invoke, stubCommands } from "./tauri";

export const REPO = "https://github.com/priyansh19/WinFynd";

export interface Release {
  version: string;
  url: string;
  newer: boolean;
}

export const openLink = (url: string) => invoke<void>("open_link", { url });
export const runSetup = () => invoke<void>("run_setup");
const latestRelease = () => invoke<Release>("latest_release");

// Registered before the startup check below, so the browser preview answers it.
stubCommands({
  open_link: () => undefined,
  run_setup: () => undefined,
  latest_release: () => ({ version: "0.1.0", url: `${REPO}/releases/tag/v0.1.0`, newer: false }),
});

/** The running version, read once. */
const appVersion = (inTauri ? getVersion() : Promise.resolve("0.1.0")).catch(() => "");

export function useAppVersion(): string {
  const [version, setVersion] = useState("");
  useEffect(() => {
    appVersion.then(setVersion);
  }, []);
  return version;
}

const CHECK = "wf.updateCheck";
/** When a check was last tried, and by which version: { at, by }. */
const ATTEMPT = "wf.updateAttempt";
const LATEST = "wf.latestRelease";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked: checks still run, they just aren't remembered.
  }
}

export const checksForUpdates = () => read(CHECK) !== "0";

/**
 * The last check's result. Its `newer` compares with the version that was
 * running then, so after an update it's dropped until the next check.
 */
async function cached(): Promise<Release | null> {
  let c: (Release & { checkedBy?: string }) | null = null;
  try {
    c = JSON.parse(read(LATEST) ?? "null");
  } catch {
    // Unreadable: the same as never checked.
  }
  return c && c.checkedBy === (await appVersion) ? c : null;
}

const listeners = new Set<(r: Release) => void>();

async function checkNow() {
  const [r, version] = await Promise.all([latestRelease(), appVersion]);
  write(LATEST, JSON.stringify({ ...r, checkedBy: version }));
  listeners.forEach((f) => f(r));
}

/**
 * Once a day, and straight away after an update. A check that fails counts
 * too, so GitHub is asked at most once a day even while it keeps failing.
 */
async function checkIfDue() {
  if (!checksForUpdates()) return;
  const version = await appVersion;
  let last: { at: number; by: string } | null = null;
  try {
    last = JSON.parse(read(ATTEMPT) ?? "null");
  } catch {
    // Unreadable: the same as never tried.
  }
  if (last && last.by === version && Date.now() - last.at < DAY) return;
  write(ATTEMPT, JSON.stringify({ at: Date.now(), by: version }));
  await checkNow();
}

// Settings loads this when WinFynd starts and stays loaded in the tray, so
// the check runs from here and not only while the About page is open.
checkIfDue().catch(() => {});
window.setInterval(() => checkIfDue().catch(() => {}), HOUR);

/**
 * The newest release, checked when WinFynd starts and then once a day while
 * it runs in the tray; null until known, and never fetched while update
 * checks are off.
 */
export function useUpdateCheck(): { release: Release | null; enabled: boolean; setEnabled: (on: boolean) => void; checkNow: () => Promise<void> } {
  const [release, setRelease] = useState<Release | null>(null);
  const [enabled, setEnabledState] = useState(checksForUpdates);

  useEffect(() => {
    cached().then(setRelease);
    listeners.add(setRelease);
    return () => {
      listeners.delete(setRelease);
    };
  }, []);

  const setEnabled = (on: boolean) => {
    write(CHECK, on ? null : "0");
    setEnabledState(on);
    if (on) checkIfDue().catch(() => {});
  };
  return { release, enabled, setEnabled, checkNow };
}
