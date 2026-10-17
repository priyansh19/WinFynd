// Result shapes the launcher renders. The on-device indexer isn't built yet,
// so `search` returns sample data shaped like what it will return.

export type ResultKind = "video" | "audio" | "image" | "document" | "slides" | "email" | "app";

export interface Moment {
  /** Where in the file the match is: a timestamp, slide or page. */
  label: string;
  /** Why it matched, shown under the preview. */
  reason: string;
}

export interface SearchResult {
  id: string;
  kind: ResultKind;
  name: string;
  path: string;
  meta: string;
  moment?: Moment;
  snippet?: string;
  /** Placeholder thumbnail colour until real thumbnails exist. */
  tint: string;
}

export interface Answer {
  text: string;
  headline?: string;
  sources: { n: number; name: string; detail: string }[];
  model: string;
}

export const GROUP_LABEL: Record<ResultKind, string> = {
  video: "Video",
  audio: "Recordings",
  image: "Images",
  document: "Documents",
  slides: "Presentations",
  email: "Email",
  app: "Apps",
};

const SAMPLE: SearchResult[] = [
  {
    id: "1", kind: "video", name: "Goa trip, beach day.mp4", path: "C:\\Users\\you\\Videos\\Goa 2026",
    meta: "Video · 22 Feb 2026 · 3:44 · 412 MB", tint: "#7fb6d8",
    moment: { label: "2:17", reason: "Matches the frame at 2:17" },
  },
  {
    id: "2", kind: "audio", name: "Product sync, 9 Mar.m4a", path: "C:\\Users\\you\\Documents\\Recordings",
    meta: "Recording · 47:10 · 3 speakers", tint: "#c79bff",
    moment: { label: "18:32", reason: "Said at 18:32" },
    snippet: "Rahul: Honestly no. The launch moves to June, we need the extra QA cycle.",
  },
  {
    id: "3", kind: "slides", name: "Board update, Q3.pptx", path: "C:\\Users\\you\\OneDrive\\Work\\Board",
    meta: "Presentation · 18 slides · 6.2 MB", tint: "#ff9e7a",
    moment: { label: "Slide 7", reason: "Matches the chart on slide 7" },
  },
  {
    id: "4", kind: "image", name: "IMG_4410.jpg", path: "C:\\Users\\you\\Pictures\\Goa 2026",
    meta: "Image · 4032 × 3024 · 3.1 MB", tint: "#d9c08e",
  },
  {
    id: "5", kind: "document", name: "Invoice_2026-03_Acme.pdf", path: "C:\\Users\\you\\Documents\\Finance",
    meta: "PDF · 2 pages · 184 KB", tint: "#f4f1ea",
    moment: { label: "Page 1", reason: "Text and logo match on page 1" },
    snippet: "Acme Studio Invoice #0342, issued March 14.",
  },
];

export async function search(query: string): Promise<SearchResult[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const hits = SAMPLE.filter((r) =>
    words.some((w) => `${r.name} ${r.snippet ?? ""} ${r.kind}`.toLowerCase().includes(w)),
  );
  return hits.length ? hits : SAMPLE;
}

export async function ask(question: string): Promise<Answer> {
  return {
    headline: "[Answer]",
    text: `Answers to "${question}" will be written by the on-device model from your indexed files, with numbered sources.`,
    sources: SAMPLE.slice(0, 3).map((r, i) => ({ n: i + 1, name: r.name, detail: r.path })),
    model: "Qwen2.5 3B (on device)",
  };
}

/** Group results by kind, keeping the order of first appearance. */
export function groupResults(results: SearchResult[]): { kind: ResultKind; items: SearchResult[] }[] {
  const groups = new Map<ResultKind, SearchResult[]>();
  for (const r of results) groups.set(r.kind, [...(groups.get(r.kind) ?? []), r]);
  return [...groups].map(([kind, items]) => ({ kind, items }));
}

/** Verb for the primary action, e.g. "Open at 2:17". */
export function openLabel(r: SearchResult): string {
  if (!r.moment) return "Open";
  return r.kind === "audio" ? `Play from ${r.moment.label}` : `Open at ${r.moment.label}`;
}
