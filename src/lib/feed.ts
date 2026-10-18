// A live view of the indexer for the Overview page. It follows the engine's
// per-file `engine://activity` events; until an engine sends those, it falls
// back to the status events: each new `current` file is the one being read
// now, and the one before it has just been indexed.
import { useEffect, useRef, useState } from "react";
import type { EngineStatus } from "./engine";
import type { ResultKind } from "./search";
import { inTauri, listen } from "./tauri";

export interface FeedItem {
  /** Unique per appearance, so the same file indexed twice animates twice. */
  key: number;
  path: string;
  kind: ResultKind;
  /** What the indexer is doing with it: "Reading", "Transcribing"… or null once done. */
  stage: string | null;
  skipped?: boolean;
  chunks?: number;
}

/** One file's progress through the indexer, from `engine://activity`. */
interface Activity {
  path: string;
  name: string;
  kind: ResultKind;
  stage: "reading" | "embedding" | "done" | "skipped";
  chunks?: number;
}

const STAGE_LABEL = { reading: "Reading", embedding: "Understanding" } as const;

const KINDS: [RegExp, ResultKind][] = [
  [/\.(jpe?g|png|gif|webp|bmp|heic|tiff?)$/i, "image"],
  [/\.(mp4|mkv|mov|avi|webm|wmv)$/i, "video"],
  [/\.(mp3|wav|m4a|flac|ogg|aac|wma)$/i, "audio"],
  [/\.(pptx?|odp|key)$/i, "slides"],
  [/\.(xlsx?|csv|ods)$/i, "spreadsheet"],
  [/\.(rs|ts|tsx|js|py|cs|cpp|c|h|java|go|json|ya?ml|toml|sql|sh|ps1)$/i, "code"],
  [/\.(pdf|docx?|odt|rtf|txt|md|html?)$/i, "document"],
];
const kindOf = (path: string): ResultKind => KINDS.find(([re]) => re.test(path))?.[1] ?? "other";

const MAX = 7;

export function useIndexingFeed(): FeedItem[] {
  const [items, setItems] = useState<FeedItem[]>([]);
  const next = useRef(0);

  useEffect(() => {
    let detailed = false;
    const onActivity = (a: Activity) => {
      detailed = true;
      setItems((list) => {
        const update: Partial<FeedItem> = {
          stage: a.stage === "done" || a.stage === "skipped" ? null : STAGE_LABEL[a.stage],
          skipped: a.stage === "skipped",
          chunks: a.chunks,
        };
        const at = list.findIndex((i) => i.path === a.path);
        if (at >= 0) return list.map((i, n) => (n === at ? { ...i, ...update } : i));
        return [{ key: next.current++, path: a.path, kind: a.kind, stage: null, ...update }, ...list].slice(0, MAX);
      });
    };
    const onStatus = (s: EngineStatus) => {
      if (detailed) return;
      const current = s.current;
      setItems((list) => {
        // "Transcribing talk.mp3" and similar describe the file already at the top.
        if (current && !/[\\/]/.test(current)) {
          const [stage] = current.split(" ");
          return list.length && list[0].stage ? [{ ...list[0], stage }, ...list.slice(1)] : list;
        }
        const done = list.map((i) => (i.stage ? { ...i, stage: null } : i));
        if (!current || done[0]?.path === current) return done;
        return [{ key: next.current++, path: current, kind: kindOf(current), stage: "Reading" }, ...done].slice(0, MAX);
      });
    };
    if (inTauri) {
      const subs = [listen<Activity>("engine://activity", onActivity), listen<EngineStatus>("engine://status", onStatus)];
      return () => subs.forEach((p) => p.then((off) => off()));
    }
    // Browser preview: a made-up stream of files so the animation can be worked on.
    const sample = [
      "C:\\Users\\you\\Downloads\\Lease agreement 2026.pdf",
      "C:\\Users\\you\\Pictures\\Screenshots\\Screenshot 2026-10-18 091422.png",
      "C:\\Users\\you\\Documents\\Budget\\Household budget.xlsx",
      "C:\\Users\\you\\Videos\\Captures\\Standup recording.mp4",
      "C:\\Users\\you\\Documents\\Notes\\Trip ideas.md",
      "C:\\Users\\you\\OneDrive\\Work\\Roadmap review.pptx",
      "C:\\Users\\you\\Music\\Voice memo 14.m4a",
    ];
    let i = 0;
    const t = setInterval(() => onStatus({ current: sample[i++ % sample.length] } as EngineStatus), 1600);
    return () => clearInterval(t);
  }, []);

  return items;
}
