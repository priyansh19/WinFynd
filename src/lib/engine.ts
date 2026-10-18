// Index status, settings and Ollama model management.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, listen, stubCommands } from "./tauri";

export interface EngineStatus {
  state: "loading" | "idle" | "scanning" | "indexing" | "paused" | "error";
  files: number;
  chunks: number;
  queued: number;
  /** Files read so far in the current pass; back to 0 once everything is read. */
  done: number;
  current: string | null;
  ollama: "ok" | "offline" | "modelMissing";
  message: string | null;
  /** Files that couldn't be read and were indexed by name only. */
  unreadable: number;
  /** Unix seconds when a pause ends, while paused. */
  pausedUntil: number | null;
}

export interface EngineConfig {
  /** "Allow full OS context": search every fixed drive. Off, only `roots`. */
  wholePc: boolean;
  /** The folders to search when `wholePc` is off. */
  roots: string[];
  /** Folders never read, on top of what's always skipped. */
  skip: string[];
  ollamaUrl: string;
  embedModel: string;
  dimensions: 768 | 512 | 256 | 128;
  chatModel: string;
  indexImages: boolean;
  speechModel: string;
  indexVideoFrames: boolean;
  /** Read OneDrive files that are only online, which downloads each one. */
  readOnlineFiles: boolean;
}

export interface SpeechModel {
  id: string;
  label: string;
  sizeMb: number;
  note: string;
  installed: boolean;
}

export interface MediaSupport {
  speechModels: SpeechModel[];
  /** Where FFmpeg was found, or null. */
  ffmpeg: string | null;
}

export interface SpeechProgress {
  id: string;
  completed: number;
  total: number;
  done: boolean;
  error: string | null;
}

export interface InstalledModel {
  name: string;
  size: number;
}

export interface PullProgress {
  model: string;
  status: string;
  completed: number;
  total: number;
  done: boolean;
  error: string | null;
}

export const getStatus = () => invoke<EngineStatus>("engine_status");
export const getConfig = () => invoke<EngineConfig>("get_engine_config");
export const setConfig = (config: EngineConfig) => invoke<EngineConfig>("set_engine_config", { config });
export const rescan = () => invoke<void>("rescan");
export const listModels = () => invoke<{ installed: InstalledModel[] | null; error: string | null }>("list_models");
export const pullModel = (model: string) => invoke<void>("pull_model", { model });
export const mediaSupport = (recheck = false) => invoke<MediaSupport>("media_support", { recheck });
export const downloadSpeechModel = (id: string) => invoke<void>("download_speech_model", { id });

/** Live index status, updated by `engine://status` events. */
export function useEngineStatus(): EngineStatus | null {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  useEffect(() => {
    getStatus().then(setStatus).catch(() => {});
    const off = listen<EngineStatus>("engine://status", setStatus);
    return () => {
      off.then((f) => f());
    };
  }, []);
  return status;
}

/** The engine config, kept in step with changes made in any window. */
export function useEngineConfig(): [EngineConfig | null, (c: EngineConfig) => Promise<EngineConfig>] {
  const [config, setLocal] = useState<EngineConfig | null>(null);
  useEffect(() => {
    getConfig().then(setLocal).catch(() => {});
    const off = listen<EngineConfig>("engine://config", setLocal);
    return () => {
      off.then((f) => f());
    };
  }, []);
  const save = useCallback(async (next: EngineConfig) => {
    const saved = await setConfig(next);
    setLocal(saved);
    return saved;
  }, []);
  return [config, save];
}

/** True while there are files left to read in the current pass. */
export const isBusy = (s: EngineStatus | null) => !!s && (s.state === "scanning" || s.state === "indexing" || s.state === "paused" || s.queued > 0);

/**
 * Seconds left in the current pass, from how fast files went by over the
 * last minute or so; NaN until there's enough to go on.
 */
export function useTimeLeft(status: EngineStatus | null): number {
  const samples = useRef<{ t: number; done: number }[]>([]);
  const [left, setLeft] = useState(NaN);
  useEffect(() => {
    if (!status || status.state !== "indexing") {
      samples.current = [];
      setLeft(NaN);
      return;
    }
    const now = Date.now();
    // Samples from an earlier pass (a higher count) don't belong to this one.
    const list = [...samples.current, { t: now, done: status.done }].filter((s) => now - s.t < 90_000 && s.done <= status.done);
    samples.current = list;
    const first = list[0];
    const rate = list.length > 3 && now - first.t > 10_000 ? (status.done - first.done) / ((now - first.t) / 1000) : 0;
    setLeft(rate > 0 ? status.queued / rate : NaN);
  }, [status]);
  return left;
}

export function formatBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} GB`;
  if (n >= 1 << 20) return `${Math.round(n / (1 << 20))} MB`;
  return `${Math.round(n / 1024)} KB`;
}

// Browser preview stubs.
let previewConfig: EngineConfig = {
  // ?scope=folders in the preview URL starts with full OS context off.
  wholePc: new URLSearchParams(location.search).get("scope") !== "folders",
  roots: ["C:\\Users\\gupta\\Documents", "C:\\Users\\gupta\\Pictures", "C:\\Users\\gupta\\OneDrive\\Desktop", "C:\\Users\\gupta\\Downloads"],
  skip: [],
  ollamaUrl: "http://127.0.0.1:11434",
  embedModel: "embeddinggemma-2",
  dimensions: 768,
  chatModel: "llama3.2:3b",
  indexImages: true,
  speechModel: "small",
  indexVideoFrames: true,
  readOnlineFiles: false,
};
export const previewEngineConfig = () => previewConfig;
stubCommands({
  // ?state=idle in the preview URL shows a finished index.
  engine_status: () =>
    new URLSearchParams(location.search).get("state") === "idle"
      ? { state: "idle", files: 51204, chunks: 412880, queued: 0, done: 0, current: null, ollama: "ok", message: null, unreadable: 0, pausedUntil: null }
      : { state: "indexing", files: 12840, chunks: 96211, queued: 38364, done: 12840, current: null, ollama: "ok", message: null, unreadable: 0, pausedUntil: null },
  get_engine_config: () => previewConfig,
  set_engine_config: ({ config }) => (previewConfig = config as EngineConfig),
  rescan: () => undefined,
  list_models: () => ({
    installed: [
      { name: "embeddinggemma-2:latest", size: 1_396_000_000 },
      { name: "llama3.2:3b", size: 2_019_000_000 },
      { name: "gemma3:4b", size: 3_338_000_000 },
    ],
    error: null,
  }),
  pull_model: () => undefined,
  media_support: () => ({
    speechModels: [
      { id: "base", label: "Whisper Base", sizeMb: 148, note: "Fastest; fine for clear speech", installed: false },
      { id: "small", label: "Whisper Small", sizeMb: 466, note: "Balanced speed and accuracy", installed: true },
      { id: "large-v3-turbo-q5_0", label: "Whisper Large v3 Turbo", sizeMb: 574, note: "Most accurate; slower on CPU", installed: false },
    ],
    ffmpeg: "C:\\ffmpeg\\bin\\ffmpeg.exe",
  }),
  download_speech_model: () => undefined,
});
