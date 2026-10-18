// Numbers for Settings and setup: files per kind overall and per folder,
// folder estimates before indexing, Ollama's version, pausing and deleting
// the index. Backed by src-tauri/src/stats.rs.
import { useCallback, useEffect, useState } from "react";
import type { KindCounts } from "./kinds";
import { invoke, listen, stubCommands } from "./tauri";

export interface FolderStats {
  path: string;
  files: number;
  kinds: KindCounts;
  /** The count stopped early on a very big folder; it's a lower bound. */
  partial: boolean;
}

export interface IndexStats {
  kinds: KindCounts;
  folders: FolderStats[];
  indexBytes: number;
}

export const getIndexStats = () => invoke<IndexStats>("index_stats");
export const estimateFolders = (paths: string[]) => invoke<FolderStats[]>("estimate_folders", { paths });
export const ollamaInfo = () => invoke<{ version: string | null }>("ollama_info");
export const pauseIndexing = (minutes: number) => invoke<void>("pause_indexing", { minutes });
export const deleteIndex = () => invoke<void>("delete_index");

/** Index stats, refreshed every few seconds while files are being read. */
export function useIndexStats(live: boolean): IndexStats | null {
  const [stats, setStats] = useState<IndexStats | null>(null);
  const refresh = useCallback(() => getIndexStats().then(setStats).catch(() => {}), []);
  useEffect(() => {
    refresh();
    if (!live) return;
    const t = window.setInterval(refresh, 4000);
    return () => window.clearInterval(t);
  }, [live, refresh]);
  useEffect(() => {
    // Folder changes from another window show up here too.
    const off = listen("engine://config", refresh);
    return () => {
      off.then((f) => f());
    };
  }, [refresh]);
  return stats;
}

// Browser preview: the design's index of 51,204 files.
const DESIGN_KINDS: KindCounts = { document: 9412, image: 21903, code: 6904, spreadsheet: 1288, slides: 640, audio: 312, video: 187, other: 10558 };
const DESIGN_FOLDERS: Record<string, KindCounts> = {
  Documents: { document: 7104, spreadsheet: 1184, slides: 640, audio: 312, other: 4968 },
  Pictures: { image: 21550, video: 187, other: 1174 },
  Desktop: { code: 6904, document: 2308, image: 353, spreadsheet: 104, other: 4416 },
  Downloads: { other: 2210, document: 820, image: 370 },
};
const sum = (k: KindCounts) => Object.values(k).reduce((a, b) => a + (b ?? 0), 0);
const folderStats = (path: string): FolderStats => {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const kinds = DESIGN_FOLDERS[name] ?? { document: 412, image: 220, other: 160 };
  return { path, files: sum(kinds), kinds, partial: false };
};
stubCommands({
  index_stats: () => ({
    kinds: DESIGN_KINDS,
    folders: ["C:\\Users\\gupta\\Documents", "C:\\Users\\gupta\\Pictures", "C:\\Users\\gupta\\OneDrive\\Desktop"].map(folderStats),
    indexBytes: 2_470_000_000,
  }),
  estimate_folders: ({ paths }) => (paths as string[]).map(folderStats),
  ollama_info: () => ({ version: "0.12.3" }),
  pause_indexing: () => undefined,
  delete_index: () => undefined,
});
