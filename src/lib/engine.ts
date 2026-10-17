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
});
