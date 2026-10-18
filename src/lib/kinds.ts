// File kinds as the engine names them, with the colour class and label the
// design gives each one. Order is how the design lists them.
import type { ResultKind } from "./search";

export const KINDS: { kind: ResultKind; cls: string; label: string; one: string }[] = [
  { kind: "document", cls: "k-doc", label: "Documents", one: "document" },
  { kind: "image", cls: "k-img", label: "Photos", one: "photo" },
  { kind: "code", cls: "k-code", label: "Code", one: "code file" },
  { kind: "spreadsheet", cls: "k-sheet", label: "Spreadsheets", one: "spreadsheet" },
  { kind: "slides", cls: "k-slide", label: "Slides", one: "presentation" },
  { kind: "audio", cls: "k-audio", label: "Recordings", one: "recording" },
  { kind: "video", cls: "k-video", label: "Videos", one: "video" },
  { kind: "other", cls: "k-other", label: "Other", one: "file" },
];

export const kindClass = (kind: string) => KINDS.find((k) => k.kind === kind)?.cls ?? "k-other";
export const kindLabel = (kind: string) => KINDS.find((k) => k.kind === kind)?.label ?? "Other";

export type KindCounts = Partial<Record<ResultKind, number>>;

export const totalOf = (counts: KindCounts) => Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);

/** "about 14,200": rounded to two significant figures above a thousand. */
export function about(n: number): string {
  if (n < 1000) return n.toLocaleString();
  const step = 10 ** (Math.floor(Math.log10(n)) - 2);
  return (Math.round(n / step) * step).toLocaleString();
}

/** "about 40 minutes left", from a rate measured over the last minutes. */
export function timeLeft(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 90) return "less than a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} minutes left`;
  const hours = Math.round(minutes / 6) / 10;
  return `about ${hours % 1 ? hours.toFixed(1) : hours} ${hours === 1 ? "hour" : "hours"} left`;
}

// The engine's own extension lists (engine/extract.rs `kind_of`), for paths
// that arrive without a kind, like an answer's sources.
const EXT_KIND: [ResultKind, string][] = [
  ["document", "txt md markdown rst log pdf docx rtf html htm eml odt"],
  ["slides", "pptx"],
  ["spreadsheet", "xlsx xlsm xls ods csv tsv"],
  ["code", "rs py js ts tsx jsx java kt c h cpp hpp cs go rb php swift sql sh ps1 bat json yaml yml toml ini xml css scss vue svelte lua r dart ipynb"],
  ["image", "jpg jpeg png webp gif bmp"],
  ["video", "mp4 mkv mov avi webm wmv m4v"],
  ["audio", "mp3 wav m4a flac ogg aac wma opus"],
];

export function kindOfPath(path: string): ResultKind {
  const ext = path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
  return EXT_KIND.find(([, exts]) => exts.split(" ").includes(ext))?.[0] ?? "other";
}

/** "14 photos, 1 video, 1 document", in the order the kinds first appear. */
export function countByKind(kinds: ResultKind[]): string {
  const counts = new Map<ResultKind, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts]
    .map(([k, n]) => {
      const one = KINDS.find((x) => x.kind === k)?.one ?? "file";
      return `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`;
    })
    .join(", ");
}
