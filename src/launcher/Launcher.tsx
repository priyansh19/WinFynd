import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { useEngineStatus } from "../lib/engine";
import { getHotkeys, type VoiceMode } from "../lib/hotkeys";
import { ask, groupResults, openResult, revealResult, search, withoutPhrase, type Answer, type FilterChip, type SearchResult } from "../lib/search";
import { invoke, listen } from "../lib/tauri";
import { AnswerPanel } from "./AnswerPanel";
import { EmptyState } from "./EmptyState";
import { Preview } from "./Preview";
import { ResultList } from "./ResultList";
import { VoiceBar, useVoice } from "./Voice";

type Mode = "search" | "ask";

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
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("hold");
  const [autoSubmit, setAutoSubmit] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(0);
  const status = useEngineStatus();

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

  useEffect(() => {
    refreshSettings();
    const subs = [
      listen("launcher://shown", () => {
        refreshSettings();
        input.current?.focus();
        input.current?.select();
      }),
      listen("launcher://ask", () => setMode("ask")),
      listen("launcher://selection", () => setMode("search")),
      listen("voice://press", () => voice.press(voiceMode)),
      listen("voice://release", () => voice.release()),
    ];
    return () => subs.forEach((p) => p.then((off) => off()));
  }, [refreshSettings, voice, voiceMode]);

  const hide = () => invoke("hide_launcher_cmd").catch(() => {});
  const current = results[selected];
  const open = (r?: SearchResult) => r && openResult(r.path).catch((e) => setError(String(e)));
  const reveal = (r?: SearchResult) => r && revealResult(r.path).catch((e) => setError(String(e)));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (voice.listening) voice.cancel();
      else if (query) setQuery("");
      else hide();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "Tab") {
      e.preventDefault();
      setMode(mode === "search" ? "ask" : "search");
      setError(null);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (mode === "ask") runAsk(query);
      else if (e.ctrlKey) reveal(current);
      else open(current);
    }
  };

  return (
    <div className="launcher" onKeyDown={onKeyDown}>
      <div className="launcher-search">
        {mode === "ask" ? (
          <span className="mode-badge">Ask</span>
        ) : (
          <Icon name="search" size={24} className="launcher-search-icon" />
        )}
        <label htmlFor="q" className="sr-only">
          {mode === "ask" ? "Ask a question about your files" : "Search your PC"}
        </label>
        <input
          id="q"
          ref={input}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          placeholder={mode === "ask" ? "Ask anything about your files, then press Enter" : "Search files, photos, documents…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className={`voice-button ${voice.listening ? "is-listening" : ""}`}
          aria-label={voice.listening ? "Stop listening" : "Start voice search"}
          aria-pressed={voice.listening}
          onClick={() => (voice.listening ? voice.release() : voice.press("toggle"))}
        >
          <Icon name="mic" />
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
      {error && <div className="launcher-error" role="alert">{error}</div>}

      <div className="launcher-body">
        {mode === "ask" ? (
          <AnswerPanel answer={answer} loading={asking} onOpen={(p) => openResult(p).catch((e) => setError(String(e)))} />
        ) : results.length ? (
          <>
            <ResultList results={results} selected={selected} onSelect={setSelected} onOpen={(i) => open(results[i])} />
            {current && <Preview result={current} onOpen={() => open(current)} onReveal={() => reveal(current)} />}
          </>
        ) : (
          <EmptyState status={status} searched={query.trim().length > 0} />
        )}
      </div>

      <footer className="launcher-footer">
        <span>
          {mode === "ask"
            ? "Answers use only your files"
            : `${results.length} ${results.length === 1 ? "result" : "results"}${semantic ? "" : " · exact words only"}`}
        </span>
        <span className="launcher-footer-keys">
          <span>Enter {mode === "ask" ? "Ask" : "Open"}</span>
          {mode === "search" && <span>Ctrl+Enter Show in folder</span>}
          <span>Tab {mode === "ask" ? "Back to search" : "Ask"}</span>
          <span>Esc Close</span>
        </span>
      </footer>
    </div>
  );
}
