// Recent searches, kept only in this PC's WebView storage so Up in an empty
// launcher brings the last one back. Privacy in Settings can turn this off
// and clear it.
const KEY = "wf.recent";
const REMEMBER = "wf.rememberSearches";
const MAX = 20;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked: nothing is remembered, which is fine.
  }
}

export const remembersSearches = () => read(REMEMBER) !== "0";

export function setRemembersSearches(on: boolean) {
  write(REMEMBER, on ? null : "0");
  if (!on) clearRecent();
}

export function recentSearches(): string[] {
  try {
    const list = JSON.parse(read(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((q) => typeof q === "string") : [];
  } catch {
    return [];
  }
}

export function rememberSearch(query: string) {
  const q = query.trim();
  if (!q || !remembersSearches()) return;
  write(KEY, JSON.stringify([q, ...recentSearches().filter((x) => x !== q)].slice(0, MAX)));
}

export const clearRecent = () => write(KEY, null);
