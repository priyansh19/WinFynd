// Search and Ask, backed by the Rust engine (EmbeddingGemma 2 via local Ollama).
import { convertFileSrc } from "@tauri-apps/api/core";
import { PREVIEW_IMAGES, PREVIEW_RESULTS } from "./previewData";
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
  image: "Photos",
  video: "Videos",
  audio: "Recordings",
  other: "Other files",
};

/** Photos whose contents are only in OneDrive, as of the last search that found them. */
const onlineOnly = new Set<string>();

export async function search(query: string): Promise<SearchResponse> {
  const res = await invoke<SearchResponse>("search", { query, limit: 30 });
  const photos = res.hits.filter((h) => h.kind === "image").map((h) => h.path);
  if (inTauri && photos.length) {
    const flags = await invoke<boolean[]>("online_only", { paths: photos }).catch(() => []);
    photos.forEach((p, i) => (flags[i] ? onlineOnly.add(p) : onlineOnly.delete(p)));
  }
  return res;
}

export const ask = (question: string) => invoke<Answer>("ask", { question });
export const transcribeVoice = (samples: Float32Array) => invoke<string>("transcribe_voice", { samples: Array.from(samples) });
export const openResult = (path: string) => invoke<void>("open_path", { path });
export const revealResult = (path: string) => invoke<void>("reveal_path", { path });

/**
 * Image thumbnails load straight from disk through Tauri's asset protocol.
 * Reading a photo that's only in OneDrive would download it, so those get
 * null and callers show Explorer's thumbnail, which OneDrive serves without
 * downloading the file.
 */
export function thumbnailUrl(r: Pick<SearchResult, "kind" | "path">): string | null {
  if (r.kind !== "image") return null;
  if (!inTauri) return previewImage(r.path);
  return onlineOnly.has(r.path) ? null : convertFileSrc(r.path);
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

/** "llama3.2:3b" reads as "llama3.2 3B". */
export function modelLabel(model: string): string {
  return model
    .replace(/:latest$/, "")
    .replace(/:(\d+(?:\.\d+)?)b$/i, " $1B")
    .replace(":", " ");
}

export function folderOf(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : path;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(1)} GB`;
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export interface ResultGroup {
  key: string;
  label: string;
  items: SearchResult[];
}

/** Confident results grouped by kind in order of first appearance, then the
 *  weaker matches in one group of their own. */
/** Which group a result is listed under. Spreadsheets and email sit with documents, as people think of them. */
function groupOf(r: SearchResult): { key: string; label: string } {
  if (r.kind === "video" && r.reason.startsWith("Shown at")) return { key: "invideo", label: "In videos" };
  if (r.kind === "spreadsheet" || r.kind === "document") return { key: "document", label: "Documents" };
  return { key: r.kind, label: GROUP_LABEL[r.kind] };
}

/** Photos are shown as a grid once there are enough of them to look through. */
export const PHOTO_GRID_MIN = 3;

/**
 * The top result as "Best match", then confident results grouped in order of
 * first appearance, then weaker matches. When photos lead and there are
 * several, the photo grid comes first instead of a best match.
 */
export function groupResults(results: SearchResult[]): ResultGroup[] {
  const confident = results.filter((r) => r.confident);
  const photos = confident.filter((r) => r.kind === "image");
  const photosLead = confident[0]?.kind === "image" && photos.length >= PHOTO_GRID_MIN;
  const out: ResultGroup[] = [];
  let rest = confident;
  if (confident.length > 1 && !photosLead) {
    out.push({ key: "best", label: "Best match", items: [confident[0]] });
    rest = confident.slice(1);
  }
  const groups = new Map<string, ResultGroup>();
  for (const r of rest) {
    const g = groupOf(r);
    const group = groups.get(g.key) ?? { ...g, items: [] };
    group.items.push(r);
    groups.set(g.key, group);
  }
  out.push(...groups.values());
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

// Browser preview (`npm run dev`): the design's searches, so the UI can be
// worked on and compared with the canvas without the Rust side.
export function previewImage(path: string): string | null {
  return inTauri ? null : (PREVIEW_IMAGES[path] ?? null);
}

stubCommands({
  search: ({ query }) => {
    const q = String(query).toLowerCase();
    const set = PREVIEW_RESULTS.find((s) => s.words.some((w) => q.includes(w)));
    const filters = /\bphotos?\b/.test(q) ? [{ label: "Photos", phrase: q.match(/\bphotos?\b/)![0] }] : [];
    return { hits: set?.hits ?? [], semantic: true, filters };
  },
  ask: () =>
    new Promise((done) =>
      setTimeout(
        () =>
          done({
            text:
              "Your lease renews automatically on **1 June 2027** for another 12 months [1]. To leave or renegotiate you need to give **60 days' written notice**, so by **2 April 2027** [1].\n\n" +
              "Your landlord confirmed that notice can go by email to leasing@harbourviewliving.com [2]. Rent rises 3% at renewal, to $2,266 a month [1] [3].",
            sources: [
              { n: 1, name: "Lease_Renewal_2026_Signed.pdf", path: "C:\\Users\\gupta\\Documents\\Home\\Lease_Renewal_2026_Signed.pdf", location: "Page 4 · clause 12.2" },
              { n: 2, name: "RE: Lease renewal questions.eml", path: "C:\\Users\\gupta\\Documents\\Mail\\RE: Lease renewal questions.eml", location: "9 January 2026" },
              { n: 3, name: "Household budget 2027.xlsx", path: "C:\\Users\\gupta\\Documents\\Home\\Household budget 2027.xlsx", location: "Sheet Monthly · Rent" },
            ],
            model: "llama3.2:3b",
          }),
        600,
      ),
    ),
  open_path: () => undefined,
  reveal_path: () => undefined,
  transcribe_voice: () => "find the slides about the Q3 budget",
});
