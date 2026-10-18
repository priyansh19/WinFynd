// The live corner: the files the indexer is reading right now, from the
// engine's batched `engine://activity` events (an array of file updates at
// most every 250 ms, each file once at its latest stage).
import { useEffect, useRef, useState } from "react";
import type { ResultKind } from "./search";
import { inTauri, listen } from "./tauri";

export type Stage = "reading" | "embedding" | "done" | "skipped";

/** One file's progress through the indexer, as the engine sends it. */
export interface Activity {
  path: string;
  name: string;
  kind: ResultKind;
  stage: Stage;
  chunks?: number;
}

export interface FeedItem extends Activity {
  /** Unique per appearance, so the same file read twice animates twice. */
  key: number;
}

const MAX = 6;

/** Fold a batch into the feed: new files slide in at the top, known ones change stage in place. */
export function applyBatch(list: FeedItem[], batch: Activity[], nextKey: () => number): FeedItem[] {
  let out = list;
  for (const a of batch) {
    const at = out.findIndex((i) => i.path === a.path);
    if (at >= 0 && out[at].stage !== "done" && out[at].stage !== "skipped") {
      out = out.map((i, n) => (n === at ? { ...i, stage: a.stage, chunks: a.chunks } : i));
    } else {
      out = [{ ...a, key: nextKey() }, ...out];
    }
  }
  return out.slice(0, MAX);
}

/** Per-kind tallies of files finished since the window opened, for "Read so far". */
export type Finished = Partial<Record<ResultKind, number>>;

export function useIndexingFeed(): { items: FeedItem[]; finished: Finished } {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [finished, setFinished] = useState<Finished>({});
  const next = useRef(0);

  useEffect(() => {
    const onBatch = (batch: Activity[] | Activity) => {
      const list = Array.isArray(batch) ? batch : [batch];
      if (!list.length) return;
      setItems((cur) => applyBatch(cur, list, () => next.current++));
      const done = list.filter((a) => a.stage === "done" || a.stage === "skipped");
      if (done.length) {
        setFinished((f) => {
          const n = { ...f };
          for (const a of done) n[a.kind] = (n[a.kind] ?? 0) + 1;
          return n;
        });
      }
    };
    if (inTauri) {
      const off = listen<Activity[]>("engine://activity", onBatch);
      return () => {
        off.then((f) => f());
      };
    }
    // Browser preview: the design's stream of files, so the motion can be worked on.
    const sample: [string, ResultKind][] = [
      ["Screenshot 2026-10-18 101422.png", "image"],
      ["Expenses October.csv", "spreadsheet"],
      ["PXL_20261017_184455.jpg", "image"],
      ["Meeting notes 18 Oct.md", "document"],
      ["Demo walkthrough.mp4", "video"],
      ["Budget sync 2026-10-02.m4a", "audio"],
      ["Q4 roadmap.pptx", "slides"],
      ["search.rs", "code"],
      ["Lease_Renewal_2026_Signed.pdf", "document"],
    ];
    let i = 0;
    const tick = () => {
      const [name, kind] = sample[i++ % sample.length];
      const path = `C:\\Users\\gupta\\Documents\\${name}`;
      const prev = sample[(i + sample.length - 2) % sample.length];
      onBatch([
        { path: `C:\\Users\\gupta\\Documents\\${prev[0]}`, name: prev[0], kind: prev[1], stage: "done", chunks: 3 },
        { path, name, kind, stage: "reading" },
      ]);
    };
    for (let n = 0; n < 5; n++) tick();
    const t = setInterval(tick, 1800);
    return () => clearInterval(t);
  }, []);

  return { items, finished };
}
