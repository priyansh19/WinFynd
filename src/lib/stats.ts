// Numbers for Settings and setup: files per kind overall and per folder or
// drive, estimates before indexing, the drives and their sizes, Ollama's
// version, pausing and deleting the index. Backed by src-tauri/src/stats.rs.
import { useCallback, useEffect, useState } from "react";
import { previewEngineConfig } from "./engine";
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

/** A fixed drive. */
export interface Drive {
  /** "C:\\" */
  path: string;
  /** The volume's name; empty when it has none. */
  label: string;
  totalBytes: number;
  freeBytes: number;
  /** The drive Windows runs from. */
  system: boolean;
}

export const getIndexStats = () => invoke<IndexStats>("index_stats");
export const listDrives = () => invoke<Drive[]>("list_drives");
/** Whether WinFynd starts in the tray when you sign in to Windows. */
export const startsWithWindows = () => invoke<boolean>("start_with_windows");
export const setStartsWithWindows = (on: boolean) => invoke<boolean>("set_start_with_windows", { on });
export const estimateFolders = (paths: string[]) => invoke<FolderStats[]>("estimate_folders", { paths });
export const ollamaInfo = () => invoke<{ version: string | null }>("ollama_info");
export const pauseIndexing = (minutes: number) => invoke<void>("pause_indexing", { minutes });
export const deleteIndex = () => invoke<void>("delete_index");

/** "C:" */
export const driveLetter = (path: string) => path.replace(/[\\/]+$/, "");
/** "Windows (C:)", or "Local Disk (C:)" like Explorer when it has no name. */
export const driveName = (d: Drive) => `${d.label || "Local Disk"} (${driveLetter(d.path)})`;
export const onDrive = (path: string, d: Drive) => path.toLowerCase().startsWith(d.path.toLowerCase());

/** Sizes the way Explorer shows them: "953 GB", "1.8 TB". */
export function diskSize(bytes: number): string {
  const gb = bytes / 2 ** 30;
  return gb >= 1000 ? `${(bytes / 2 ** 40).toFixed(1).replace(/\.0$/, "")} TB` : `${Math.round(gb)} GB`;
}

/** "412 GB used of 953 GB" */
export const driveUsage = (d: Drive) => `${diskSize(d.totalBytes - d.freeBytes)} used of ${diskSize(d.totalBytes)}`;

/** "C: and D:", or with `bare` "C and D". */
export function driveList(drives: Drive[], bare = false): string {
  const l = drives.map((d) => (bare ? driveLetter(d.path).replace(/:$/, "") : driveLetter(d.path)));
  return l.length > 1 ? `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}` : (l[0] ?? "");
}

/** The fixed drives, read when the page opens; null until known. */
export function useDrives(): Drive[] | null {
  const [drives, setDrives] = useState<Drive[] | null>(null);
  useEffect(() => {
    let live = true;
    listDrives()
      .then((d) => live && setDrives(d))
      .catch(() => live && setDrives([]));
    return () => {
      live = false;
    };
  }, []);
  return drives;
}

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
  "C:": { document: 9412, image: 13203, code: 6904, spreadsheet: 1288, slides: 640, audio: 112, video: 37, other: 8216 },
  "D:": { image: 8700, video: 150, audio: 200, other: 2342 },
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
const DESIGN_DRIVES: Drive[] = [
  { path: "C:\\", label: "Windows", totalBytes: 953 * 2 ** 30, freeBytes: 541 * 2 ** 30, system: true },
  { path: "D:\\", label: "Data", totalBytes: 1.8 * 2 ** 40, freeBytes: 1.8 * 2 ** 40 - 688 * 2 ** 30, system: false },
];
stubCommands({
  index_stats: () => {
    const c = previewEngineConfig();
    const drives = c.wholePc ? DESIGN_DRIVES.map((d) => d.path).filter((p) => !c.skip.includes(p)) : [];
    const folders = [...drives, ...c.roots.filter((r) => !c.wholePc || !DESIGN_DRIVES.some((d) => onDrive(r, d)))];
    return { kinds: DESIGN_KINDS, folders: folders.map(folderStats), indexBytes: 2_470_000_000 };
  },
  list_drives: () => DESIGN_DRIVES,
  estimate_folders: ({ paths }) => (paths as string[]).map(folderStats),
  ollama_info: () => ({ version: "0.12.3" }),
  start_with_windows: () => true,
  set_start_with_windows: ({ on }) => on,
  pause_indexing: () => undefined,
  delete_index: () => undefined,
});
