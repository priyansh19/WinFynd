// Search and Ask, backed by the Rust engine (EmbeddingGemma 2 via local Ollama).
import { convertFileSrc } from "@tauri-apps/api/core";
import { inTauri, invoke, stubCommands } from "./tauri";

export type ResultKind = "document" | "slides" | "spreadsheet" | "code" | "image" | "video" | "audio" | "other";

export interface SearchResult {
  id: number;
  kind: ResultKind;
  name: string;
  path: string;
  size: number;
  /** Unix seconds. */
  modified: number;
  /** "Page 3", "Slide 7", "Sheet Q1"… */
  location: string | null;
  snippet: string | null;
  reason: string;
  /** False for weaker matches, listed after the confident ones. */
  confident: boolean;
}

/** A filter the engine read from the query, like "Photos" from "photo of". */
export interface FilterChip {
  label: string;
  /** The words in the query that set it; removing them drops the filter. */
  phrase: string;
}

export interface SearchResponse {
  hits: SearchResult[];
  /** False when only exact-word search ran (Ollama offline). */
  semantic: boolean;
  filters: FilterChip[];
}

export interface Answer {
  text: string;
  sources: { n: number; name: string; path: string; location: string | null }[];
  model: string;
}

export const GROUP_LABEL: Record<ResultKind, string> = {
  document: "Documents",
  slides: "Presentations",
  spreadsheet: "Spreadsheets",
  code: "Code",
  image: "Images",
  video: "Video",
  audio: "Audio",
  other: "Other files",
};

export const KIND_TINT: Record<ResultKind, string> = {
  document: "#8db8ff",
  slides: "#ff9e7a",
  spreadsheet: "#8fe0aa",
  code: "#c79bff",
  image: "#d9c08e",
  video: "#7fb6d8",
  audio: "#c79bff",
  other: "#bdb3ae",
};

export const search = (query: string) => invoke<SearchResponse>("search", { query, limit: 30 });
export const ask = (question: string) => invoke<Answer>("ask", { question });
export const openResult = (path: string) => invoke<void>("open_path", { path });
export const revealResult = (path: string) => invoke<void>("reveal_path", { path });

/** Image thumbnails load straight from disk through Tauri's asset protocol. */
export function thumbnailUrl(r: SearchResult): string | null {
  return r.kind === "image" && inTauri ? convertFileSrc(r.path) : null;
}

/** Seconds into a recording for labels like "1:23" or "1:02:03"; null otherwise. */
export function secondsOf(label: string | null | undefined): number | null {
  if (!label || !/^\d+(:\d{2}){1,2}$/.test(label)) return null;
  return label.split(":").reduce((t, part) => t * 60 + Number(part), 0);
}

/** A playable URL for audio and video, starting at the matching moment. */
export function mediaUrl(r: SearchResult): string | null {
  if ((r.kind !== "video" && r.kind !== "audio") || !inTauri) return null;
  const at = secondsOf(r.location);
  return convertFileSrc(r.path) + (at ? `#t=${at}` : "");
}

export function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase().slice(0, 4) : "FILE";
}

export function folderOf(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : path;
}

export function describe(r: SearchResult): string {
  const size =
    r.size >= 1 << 30 ? `${(r.size / (1 << 30)).toFixed(1)} GB`
    : r.size >= 1 << 20 ? `${(r.size / (1 << 20)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(r.size / 1024))} KB`;
  const date = new Date(r.modified * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return `${GROUP_LABEL[r.kind].replace(/s$/, "")} · ${size} · Modified ${date}`;
}

export interface ResultGroup {
  key: string;
  label: string;
  items: SearchResult[];
}

/** Confident results grouped by kind in order of first appearance, then the
 *  weaker matches in one group of their own. */
export function groupResults(results: SearchResult[]): ResultGroup[] {
  const groups = new Map<ResultKind, SearchResult[]>();
  for (const r of results) if (r.confident) groups.set(r.kind, [...(groups.get(r.kind) ?? []), r]);
  const out: ResultGroup[] = [...groups].map(([kind, items]) => ({ key: kind, label: GROUP_LABEL[kind], items }));
  const weak = results.filter((r) => !r.confident);
  if (weak.length) out.push({ key: "weak", label: "Weaker matches", items: weak });
  return out;
}

/** The query with a filter's words taken out. */
export function withoutPhrase(query: string, phrase: string): string {
  const i = query.toLowerCase().indexOf(phrase.toLowerCase());
  if (i < 0) return query;
  return (query.slice(0, i) + query.slice(i + phrase.length)).replace(/\s+/g, " ").trim();
}

// Browser preview (`npm run dev`): sample results so the UI can be worked on
// without the Rust side.
const SAMPLE: SearchResult[] = [
  { id: 1, kind: "document", name: "Invoice_2026-03_Acme.pdf", path: "C:\\Users\\you\\Documents\\Finance\\Invoice_2026-03_Acme.pdf", size: 188_000, modified: 1773446400, location: "Page 1", snippet: "Acme Studio Invoice #0342, issued March 14. Total due within 30 days.", reason: "Exact words on page 1", confident: true },
  { id: 2, kind: "slides", name: "Board update, Q3.pptx", path: "C:\\Users\\you\\OneDrive\\Work\\Board update, Q3.pptx", size: 6_500_000, modified: 1789000000, location: "Slide 7", snippet: "FY26 revenue by region: North, South, East, West, International", reason: "Matches the meaning on slide 7", confident: true },
  { id: 3, kind: "image", name: "IMG_4410.jpg", path: "C:\\Users\\you\\Pictures\\Goa 2026\\IMG_4410.jpg", size: 3_100_000, modified: 1771718400, location: null, snippet: null, reason: "Image matches your search", confident: true },
  { id: 4, kind: "video", name: "Goa trip, beach day.mp4", path: "C:\\Users\\you\\Videos\\Goa 2026\\Goa trip, beach day.mp4", size: 412_000_000, modified: 1771718400, location: null, snippet: null, reason: "Name is a close match", confident: false },
];
stubCommands({
  search: ({ query }) => {
    const q = String(query).toLowerCase();
    const hits = SAMPLE.filter((r) => q.split(/\s+/).some((w) => w && `${r.name} ${r.snippet ?? ""}`.toLowerCase().includes(w)));
    const filters = /\bphotos?\b/.test(q) ? [{ label: "Photos", phrase: q.match(/\bphotos?\b/)![0] }] : [];
    return { hits: hits.length ? hits : SAMPLE, semantic: true, filters };
  },
  ask: ({ question }) => ({
    text: `In the desktop app, answers to "${question}" are written by your local Ollama model from the passages below [1].`,
    sources: SAMPLE.slice(0, 2).map((r, i) => ({ n: i + 1, name: r.name, path: r.path, location: r.location })),
    model: "preview",
  }),
  open_path: () => undefined,
  reveal_path: () => undefined,
});
