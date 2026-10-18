import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Keycap } from "../components/Keycap";
import { Menu, type MenuItem } from "../components/Menu";
import { useEngineStatus } from "../lib/engine";
import { getHotkeys, type VoiceMode } from "../lib/hotkeys";
import { useFitWindowHeight } from "../lib/native";
import { ask, groupResults, openResult, revealResult, search, withoutPhrase, type Answer, type FilterChip, type SearchResult } from "../lib/search";
import { invoke, listen } from "../lib/tauri";
import { AnswerPanel } from "./AnswerPanel";
import { EmptyState } from "./EmptyState";
import { Preview } from "./Preview";
import { ResultList } from "./ResultList";
import { VoiceBar, useVoice } from "./Voice";

type Mode = "search" | "ask";
type MenuAt = { right: number; bottom: number } | { left: number; top: number };

export function Launcher() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("search");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [semantic, setSemantic] = useState(true);
  const [filters, setFilters] = useState<FilterChip[]>([]);
  const [selected, setSelected] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("hold");
  const [autoSubmit, setAutoSubmit] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(0);
  const status = useEngineStatus();
  useFitWindowHeight(root);

  const runSearch = useCallback(async (q: string) => {
    const id = ++latest.current;
    if (!q.trim()) {
      setResults([]);
      setFilters([]);
      return;
    }
    try {
      const r = await search(q);
      if (id !== latest.current) return; // a newer keystroke won
      // Keep the list in the order it's shown so the arrow keys follow it.
      setResults(groupResults(r.hits).flatMap((g) => g.items));
      setSemantic(r.semantic);
      setFilters(r.filters);
      setSelected(0);
      setError(null);
    } catch (e) {
      if (id === latest.current) setError(String(e));
    }
  }, []);

  const runAsk = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setAsking(true);
    setAnswer(null);
    setError(null);
    try {
      setAnswer(await ask(q));
    } catch (e) {
      setError(String(e));
    } finally {
      setAsking(false);
    }
  }, []);

  const voice = useVoice({
    onTranscript: (text, final) => {
      if (!text) return;
      setQuery(text);
      if (final && autoSubmit && mode === "ask") runAsk(text);
    },
  });

  // Search as you type, lightly debounced so each keystroke doesn't embed.
  useEffect(() => {
    if (mode !== "search") return;
    const t = setTimeout(() => runSearch(query), 120);
    return () => clearTimeout(t);
  }, [query, mode, runSearch]);

  const refreshSettings = useCallback(() => {
    getHotkeys()
      .then(({ config }) => {
        setVoiceMode(config.voiceMode);
        setAutoSubmit(config.autoSubmit);
      })
      .catch(() => {});
  }, []);

  const switchMode = useCallback((next: Mode) => {
    setMode(next);
    setError(null);
    setMenu(null);
    input.current?.focus();
  }, []);

  useEffect(() => {
    refreshSettings();
    const subs = [
      listen("launcher://shown", () => {
        refreshSettings();
        setMenu(null);
        input.current?.focus();
        input.current?.select();
      }),
      listen("launcher://ask", () => switchMode("ask")),
      listen("launcher://selection", () => switchMode("search")),
      listen("voice://press", () => voice.press(voiceMode)),
      listen("voice://release", () => voice.release()),
    ];
    return () => subs.forEach((p) => p.then((off) => off()));
  }, [refreshSettings, switchMode, voice, voiceMode]);

  // A short confirmation, like "Path copied", in the command bar.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2000);
    return () => clearTimeout(t);
  }, [notice]);

  const hide = () => invoke("hide_launcher_cmd").catch(() => {});
  const current = mode === "search" ? results[selected] : undefined;
  const open = (r?: SearchResult) => r && openResult(r.path).catch((e) => setError(String(e)));
  const reveal = (r?: SearchResult) => r && revealResult(r.path).catch((e) => setError(String(e)));
  const copyPath = (r?: SearchResult) =>
    r &&
    navigator.clipboard
      .writeText(r.path)
      .then(() => setNotice("Path copied"))
      .catch((e) => setError(String(e)));

  const actions: MenuItem[] = current
    ? [
        { label: current.location ? `Open at ${current.location}` : "Open", icon: "open", shortcut: "Enter", run: () => open(current) },
        { label: "Open file location", icon: "folderOpen", shortcut: "Ctrl+Shift+E", run: () => reveal(current) },
        { label: "Copy as path", icon: "copy", shortcut: "Ctrl+Shift+C", run: () => copyPath(current) },
      ]
    : [];

  const onQueryChange = (value: string) => {
    // "?" at the start asks a question instead, like a launcher prefix.
    if (mode === "search" && value.startsWith("?")) {
      switchMode("ask");
      value = value.slice(1).trimStart();
    }
    setQuery(value);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (e.key === "Escape") {
      if (voice.listening) voice.cancel();
      else if (query) setQuery("");
      else if (mode === "ask") switchMode("search");
      else hide();
    } else if (e.key === "Backspace" && !query && mode === "ask") {
      switchMode("search");
    } else if (mode === "search" && results.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const step = e.key === "ArrowDown" ? 1 : -1;
      setSelected((i) => (i + step + results.length) % results.length);
    } else if (mode === "search" && results.length && (e.key === "PageDown" || e.key === "PageUp")) {
      const step = e.key === "PageDown" ? 5 : -5;
      setSelected((i) => Math.max(0, Math.min(results.length - 1, i + step)));
    } else if (e.key === "Enter" && mode === "ask") {
      runAsk(query);
    } else if (e.key === "Enter" && (e.ctrlKey || e.shiftKey)) {
      reveal(current);
    } else if (e.key === "Enter") {
      open(current);
    } else if (e.ctrlKey && e.shiftKey && key === "e") {
      reveal(current);
    } else if (e.ctrlKey && e.shiftKey && key === "c") {
      copyPath(current);
    } else if (current && ((e.ctrlKey && key === "k") || (e.shiftKey && e.key === "F10") || e.key === "ContextMenu")) {
      setMenu({ right: 8, bottom: 44 });
    } else {
      return;
    }
    e.preventDefault();
  };

  const searching = mode === "search" && query.trim().length > 0;
  const expanded = mode === "ask" || searching;

  return (
    <div ref={root} className={`launcher ${expanded ? "is-expanded" : ""}`} onKeyDown={onKeyDown}>
      <div className="launcher-search">
        <Icon name={mode === "ask" ? "ask" : "search"} size={20} className={`launcher-search-icon ${mode === "ask" ? "is-ask" : ""}`} />
        <input
          ref={input}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-label={mode === "ask" ? "Ask a question about your files" : "Search your PC"}
          aria-expanded={mode === "search" && results.length > 0}
          aria-controls="results"
          aria-activedescendant={current ? `result-${selected}` : undefined}
          placeholder={mode === "ask" ? "Ask a question about your files" : "Search your PC, or type ? to ask a question"}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-subtle launcher-mode"
          aria-pressed={mode === "ask"}
          title="Ask a question about your files"
          onClick={() => switchMode(mode === "ask" ? "search" : "ask")}
        >
          <Icon name="sparkle" size={16} />
          Ask
        </button>
        <button
          type="button"
          className="btn btn-subtle btn-icon"
          aria-label={voice.listening ? "Stop listening" : "Search by voice"}
          title={voice.listening ? "Stop listening" : "Search by voice"}
          aria-pressed={voice.listening}
          onClick={() => (voice.listening ? voice.release() : voice.press("toggle"))}
        >
          <Icon name={voice.listening ? "micOn" : "mic"} size={16} />
        </button>
      </div>

      {mode === "search" && filters.length > 0 && (
        <div className="filter-chips" aria-label="Filters from your search">
          {filters.map((f) => (
            <button
              key={f.label}
              type="button"
              className="filter-chip"
              title={`Remove "${f.phrase}" from the search`}
              onClick={() => {
                setQuery(withoutPhrase(query, f.phrase));
                input.current?.focus();
              }}
            >
              {f.label} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
      {voice.listening && <VoiceBar level={voice.level} mode={voiceMode} />}
      {error && (
        <div className="launcher-error" role="alert">
          <Icon name="error" size={16} />
          <span className="selectable">{error}</span>
        </div>
      )}
      {!expanded && <EmptyState status={status} searched={false} />}

      {expanded && (
        <div className={`launcher-body ${mode === "search" && !results.length ? "is-empty" : ""}`}>
          {mode === "ask" ? (
            <AnswerPanel answer={answer} loading={asking} onOpen={(p) => openResult(p).catch((e) => setError(String(e)))} />
          ) : results.length ? (
            <>
              <ResultList
                results={results}
                selected={selected}
                onSelect={setSelected}
                onOpen={(i) => open(results[i])}
                onContextMenu={(i, x, y) => {
                  setSelected(i);
                  setMenu({ left: Math.min(x, window.innerWidth - 240), top: Math.min(y, window.innerHeight - 140) });
                }}
              />
              {current && <Preview result={current} />}
            </>
          ) : (
            <EmptyState status={status} searched />
          )}
        </div>
      )}

      {expanded && (
        <footer className="command-bar">
          <span className="command-bar-status" role="status">
            {notice ? (
              <>
                <Icon name="checkmark" size={16} />
                {notice}
              </>
            ) : (
              <>
                <Icon name="lock" size={16} />
                {mode === "ask"
                  ? "Answers come only from files on this PC"
                  : `${results.length} ${results.length === 1 ? "result" : "results"} on this PC${semantic ? "" : " · exact words only"}`}
              </>
            )}
          </span>
          {mode === "ask" ? (
            <button type="button" className="btn btn-subtle command" onClick={() => runAsk(query)} disabled={!query.trim() || asking}>
              Ask <Keycap small>Enter</Keycap>
            </button>
          ) : (
            current && (
              <>
                <button type="button" className="btn btn-subtle command" onClick={() => open(current)}>
                  Open <Keycap small>Enter</Keycap>
                </button>
                <span className="command-sep" aria-hidden="true" />
                <button
                  type="button"
                  className="btn btn-subtle command"
                  aria-haspopup="menu"
                  aria-expanded={!!menu}
                  onClick={() => setMenu(menu ? null : { right: 8, bottom: 44 })}
                >
                  More actions <Keycap small>Ctrl</Keycap>
                  <Keycap small>K</Keycap>
                </button>
              </>
            )
          )}
        </footer>
      )}

      {menu && actions.length > 0 && (
        <Menu label="Actions" items={actions} style={menu} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
