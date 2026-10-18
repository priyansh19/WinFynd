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
  | { kind: "words"; words: string[]; meaning: boolean }
  | { kind: "looks"; words: string[] }
  | { kind: "meaning" }
  | { kind: "name" };

/** Read the engine's reason for a hit into what the chips say. */
export function reasonOf(r: SearchResult, query: string): Reason {
  const words = queryWords(query);
  const found = wordsIn(`${r.snippet ?? ""} ${r.name}`, words);
  const visual = r.reason.startsWith("Image matches") || r.reason.startsWith("Shown at");
  if (visual) return { kind: "looks", words };
  if (found.length) return { kind: "words", words: found, meaning: /meaning|Talked about/.test(r.reason) };
  if (/^Name/.test(r.reason)) return { kind: "name" };
  return { kind: "meaning" };
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

/** A short line of the snippet around the first matched word, for the result row. */
export function excerpt(snippet: string | null, words: string[], max = 72): string | null {
  if (!snippet) return null;
  const clean = snippet.replace(/\s+/g, " ").replace(/^…\s*/, "").replace(/\s*…$/, "").trim();
  const lower = clean.toLowerCase();
  const at = Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0), Infinity);
  if (!isFinite(at) || at < max / 2) return clean.length > max ? clean.slice(0, max).replace(/\s\S*$/, "") : clean;
  const start = clean.lastIndexOf(" ", at - 12) + 1;
  const s = clean.slice(start, start + max);
  return s.length < clean.length - start ? s.replace(/\s\S*$/, "") : s;
}

/** "12:05" style labels from the engine, used for recordings and videos. */
export const isTimestamp = (label: string | null | undefined) => !!label && /^\d+(:\d{2}){1,2}$/.test(label);
