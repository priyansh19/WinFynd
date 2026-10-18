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

export function useAppVersion(): string {
  const [version, setVersion] = useState("");
  useEffect(() => {
    (inTauri ? getVersion() : Promise.resolve("0.1.0")).then(setVersion).catch(() => {});
  }, []);
  return version;
}

const CHECK = "wf.updateCheck";
const CHECKED_AT = "wf.updateCheckedAt";
const LATEST = "wf.latestRelease";
const DAY = 24 * 60 * 60 * 1000;

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

function cached(): Release | null {
  try {
    return JSON.parse(read(LATEST) ?? "null");
  } catch {
    return null;
  }
}

/**
 * The newest release, checked when Settings opens and then once a day while
 * it stays open in the tray; null until known, and never fetched while
 * update checks are off.
 */
export function useUpdateCheck(): { release: Release | null; enabled: boolean; setEnabled: (on: boolean) => void; checkNow: () => Promise<void> } {
  const [release, setRelease] = useState<Release | null>(cached);
  const [enabled, setEnabledState] = useState(checksForUpdates);

  const checkNow = async () => {
    const r = await latestRelease();
    write(LATEST, JSON.stringify(r));
    write(CHECKED_AT, String(Date.now()));
    setRelease(r);
  };

  useEffect(() => {
    if (!enabled) return;
    const due = () => Date.now() - Number(read(CHECKED_AT) ?? 0) > DAY;
    if (due()) checkNow().catch(() => {});
    const t = window.setInterval(() => due() && checkNow().catch(() => {}), 60 * 60 * 1000);
    return () => window.clearInterval(t);
  }, [enabled]);

  const setEnabled = (on: boolean) => {
    write(CHECK, on ? null : "0");
    setEnabledState(on);
  };
  return { release, enabled, setEnabled, checkNow };
}

stubCommands({
  open_link: () => undefined,
  run_setup: () => undefined,
  latest_release: () => ({ version: "0.1.0", url: `${REPO}/releases/tag/v0.1.0`, newer: false }),
});
