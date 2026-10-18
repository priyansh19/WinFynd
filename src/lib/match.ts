// Why a result matched, in words the user typed: which query words appear in
// it (highlighted in the preview), and whether it matched on meaning.
import type { SearchResult } from "./search";

const STOP = new Set(
  ("a an and any are as at be by can did do does find for from get had has have how i in is it its me my of on or our show " +
    "that the their this to was we were what when where which who with you your about all into last some").split(" "),
);

/** The words in a query worth matching on. */
export function queryWords(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  return [...new Set(words.filter((w) => w.length > 1 && !STOP.has(w)))];
}

/** A word "appears" when the text has it, or a longer form of it (sofa → sofas). */
const wordRe = (w: string) => new RegExp(`(^|[^\\p{L}\\p{N}])(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\p{L}]{0,3})(?=$|[^\\p{L}\\p{N}])`, "iu");

export function wordsIn(text: string, words: string[]): string[] {
  return words.filter((w) => wordRe(w).test(text));
}

export type Reason =
  | { kind: "words"; words: string[]; meaning: string | null }
  | { kind: "looks"; words: string[] }
  | { kind: "meaning"; concept: string }
  | { kind: "name" };

/** Read the engine's reason for a hit into what the chips say. */
export function reasonOf(r: SearchResult, query: string): Reason {
  const words = queryWords(query);
  const found = wordsIn(`${r.snippet ?? ""} ${r.name}`, words);
  // What the meaning matched: the query words that aren't in the text, else all of them.
  const rest = words.filter((w) => !found.includes(w));
  const concept = (rest.length ? rest : words).join(", ");
  const visual = r.reason.startsWith("Image matches") || r.reason.startsWith("Shown at");
  if (visual) return { kind: "looks", words };
  if (found.length) return { kind: "words", words: found, meaning: /meaning|Talked about/.test(r.reason) && concept ? concept : null };
  if (/^Name/.test(r.reason)) return { kind: "name" };
  return { kind: "meaning", concept };
}

/** Split text into plain and highlighted runs for the query words. */
export function highlight(text: string, words: string[]): { text: string; hit: boolean }[] {
  if (!words.length) return [{ text, hit: false }];
  const alt = [...words]
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\p{L}]{0,3}")
    .join("|");
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`, "giu");
  const out: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), hit: false });
    out.push({ text: m[0], hit: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  // Neighbouring hits read as one phrase: "sofa, navy".
  return out.reduce<{ text: string; hit: boolean }[]>((acc, run) => {
    const prev = acc[acc.length - 1];
    const between = acc[acc.length - 2];
    if (run.hit && prev && !prev.hit && /^[\s,]{1,3}$/.test(prev.text) && between?.hit) {
      acc.splice(acc.length - 2, 2, { text: between.text + prev.text + run.text, hit: true });
    } else acc.push(run);
    return acc;
  }, []);
}

/**
 * A short phrase of the snippet for the result row: from the start of the
 * clause with the first matched word, cut at a word so the line fits whole.
 */
export function excerpt(snippet: string | null, words: string[], max = 40): string | null {
  if (!snippet) return null;
  max = Math.max(8, max);
  // Lines (table rows, headings) read as clauses of their own.
  const clean = snippet.trim().replace(/\s*\n\s*/g, " · ").replace(/\s+/g, " ").replace(/^…\s*/, "").replace(/\s*…$/, "");
  const lower = clean.toLowerCase();
  const at = Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0), Infinity);
  let start = 0;
  if (isFinite(at)) {
    // The clause the word is in, unless it starts too far back to show the word.
    const clause = Math.max(0, ...[". ", ": ", "; ", "! ", "? ", " · "].map((p) => lower.lastIndexOf(p, at - 1)).filter((i) => i >= 0).map((i) => i + 2));
    start = at - clause > max / 2 ? at : clause;
  }
  const s = clean.slice(start).trim();
  if (s.length <= max) return s.replace(/[.,;:]$/, "");
  const cut = s.slice(0, max + 1).replace(/\s+\S*$/, "");
  return (cut || s.slice(0, max)).replace(/[\s.,;:·-]+$/, "");
}

/** "12:05" style labels from the engine, used for recordings and videos. */
export const isTimestamp = (label: string | null | undefined) => !!label && /^\d+(:\d{2}){1,2}$/.test(label);
