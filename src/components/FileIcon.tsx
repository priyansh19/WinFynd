import { useShellImage } from "../lib/native";
import { thumbnailUrl, type ResultKind } from "../lib/search";

/** Badge colour per extension; files without one get the label of their kind. */
const BADGE: Record<string, string> = {
  PDF: "#e5484d", DOC: "#2f6ce5", EML: "#2f6ce5", RTF: "#2f6ce5", ODT: "#2f6ce5", MSG: "#2f6ce5", HTM: "#2f6ce5",
  TXT: "#6b7280", MD: "#6b7280", LOG: "#6b7280",
  XLS: "#1d8f53", CSV: "#1d8f53", ODS: "#1d8f53",
  PPT: "#d9622b", ODP: "#d9622b", KEY: "#d9622b",
  MP4: "#c43d6a", MKV: "#c43d6a", MOV: "#c43d6a", AVI: "#c43d6a", WEBM: "#c43d6a", WMV: "#c43d6a",
  M4A: "#7a4ae0", MP3: "#7a4ae0", WAV: "#7a4ae0", FLAC: "#7a4ae0", OGG: "#7a4ae0", AAC: "#7a4ae0", WMA: "#7a4ae0",
  PY: "#0e8fa3", TS: "#2f6ce5", TSX: "#2f6ce5", JS: "#b38f00", RS: "#b4500a", CS: "#6d3fd8", JSON: "#0e8fa3",
  JPG: "#c03d8a", PNG: "#c03d8a", GIF: "#c03d8a", WEBP: "#c03d8a", HEIC: "#c03d8a", BMP: "#c03d8a",
};
const ALIAS: Record<string, string> = { DOCX: "DOC", XLSX: "XLS", PPTX: "PPT", JPEG: "JPG", HTML: "HTM", MARKDOWN: "MD", TIFF: "TIF" };
const KIND_LABEL: Record<ResultKind, string> = {
  document: "DOC", slides: "PPT", spreadsheet: "XLS", code: "CODE", image: "IMG", video: "MP4", audio: "M4A", other: "FILE",
};
const KIND_COLOUR: Record<ResultKind, string> = {
  document: "#2f6ce5", slides: "#d9622b", spreadsheet: "#1d8f53", code: "#0e8fa3", image: "#c03d8a", video: "#c43d6a", audio: "#7a4ae0", other: "#6b7280",
};

export function badgeFor(path: string, kind: ResultKind): { label: string; colour: string } {
  const ext = path.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toUpperCase();
  const label = ext ? (ALIAS[ext] ?? ext) : KIND_LABEL[kind];
  if (label.length > 4) return { label: KIND_LABEL[kind], colour: KIND_COLOUR[kind] };
  return { label, colour: BADGE[label] ?? KIND_COLOUR[kind] };
}

/** A page with a coloured type badge, as drawn in the design. */
export function FileGlyph({ path, kind, size = 32 }: { path: string; kind: ResultKind; size?: number }) {
  const { label, colour } = badgeFor(path, kind);
  const fs = label.length <= 3 ? 7 : 6;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ flex: "none" }}>
      <path d="M8.5 3.5h10l7 7v17a1 1 0 0 1-1 1h-16a1 1 0 0 1-1-1v-23a1 1 0 0 1 1-1z" fill="#f4f5f8" />
      <path d="M18.5 3.5v6a1 1 0 0 0 1 1h6" fill="#d5d9e2" />
      <rect x="3" y="14" width="18" height="10" rx="2" fill={colour} />
      <text x="12" y="21.5" textAnchor="middle" fill="#fff" style={{ font: `700 ${fs}px "Segoe UI", sans-serif` }}>
        {label}
      </text>
    </svg>
  );
}

/**
 * Photos and videos show themselves (the photo, or Explorer's thumbnail of
 * the video); everything else shows its typed page glyph.
 */
export function FileIcon({ path, kind, size = 32 }: { path: string; kind: ResultKind; size?: number }) {
  const photo = kind === "image" ? thumbnailUrl({ kind, path }) : null;
  const shell = useShellImage(path, size, kind === "video" || (kind === "image" && !photo));
  const src = photo ?? (kind === "video" || kind === "image" ? shell : null);
  if (src) {
    return (
      <span className="file-thumb" style={{ width: size, height: size }}>
        <img src={src} alt="" loading="lazy" />
      </span>
    );
  }
  return <FileGlyph path={path} kind={kind} size={size} />;
}
