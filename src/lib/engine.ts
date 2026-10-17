// Index status, settings and Ollama model management.
import { useEffect, useState } from "react";
import { invoke, listen, stubCommands } from "./tauri";

export interface EngineStatus {
  state: "idle" | "scanning" | "indexing" | "error";
  files: number;
  chunks: number;
  queued: number;
  current: string | null;
  ollama: "ok" | "offline" | "modelMissing";
  message: string | null;
}

export interface EngineConfig {
  roots: string[];
  ollamaUrl: string;
  embedModel: string;
  dimensions: 768 | 512 | 256 | 128;
  chatModel: string;
  indexImages: boolean;
  speechModel: string;
  indexVideoFrames: boolean;
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

export function formatBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} GB`;
  if (n >= 1 << 20) return `${Math.round(n / (1 << 20))} MB`;
  return `${Math.round(n / 1024)} KB`;
}

// Browser preview stubs.
let previewConfig: EngineConfig = {
  roots: ["C:\\Users\\you\\Documents", "C:\\Users\\you\\Pictures", "C:\\Users\\you\\Desktop"],
  ollamaUrl: "http://127.0.0.1:11434",
  embedModel: "embeddinggemma-2",
  dimensions: 768,
  chatModel: "",
  indexImages: true,
  speechModel: "small",
  indexVideoFrames: true,
};
stubCommands({
  engine_status: () => ({ state: "idle", files: 12840, chunks: 96211, queued: 0, current: null, ollama: "ok", message: null }),
  get_engine_config: () => previewConfig,
  set_engine_config: ({ config }) => (previewConfig = config as EngineConfig),
  rescan: () => undefined,
  list_models: () => ({
    installed: [
      { name: "embeddinggemma-2:latest", size: 1_300_000_000 },
      { name: "gemma4:e4b", size: 3_200_000_000 },
    ],
    error: null,
  }),
  pull_model: () => undefined,
  media_support: () => ({
    speechModels: [
      { id: "base", label: "Whisper Base", sizeMb: 148, note: "Fastest; fine for clear speech", installed: false },
      { id: "small", label: "Whisper Small", sizeMb: 488, note: "Balanced speed and accuracy", installed: true },
      { id: "large-v3-turbo-q5_0", label: "Whisper Large v3 Turbo", sizeMb: 574, note: "Most accurate; slower on CPU", installed: false },
    ],
    ffmpeg: null,
  }),
  download_speech_model: () => undefined,
});
