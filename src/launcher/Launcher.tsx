import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { getHotkeys, type VoiceMode } from "../lib/hotkeys";
import { ask, openLabel, search, type Answer, type SearchResult } from "../lib/search";
import { invoke, listen } from "../lib/tauri";
import { AnswerPanel } from "./AnswerPanel";
import { Preview } from "./Preview";
import { ResultList } from "./ResultList";
import { VoiceBar, useVoice } from "./Voice";

type Mode = "search" | "ask";

export function Launcher() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("search");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("hold");
  const [autoSubmit, setAutoSubmit] = useState(true);
  const input = useRef<HTMLInputElement>(null);

  const runQuery = useCallback(
    async (q: string, m: Mode = mode) => {
      if (m === "ask") {
        setAnswer(q.trim() ? await ask(q) : null);
      } else {
        setResults(await search(q));
        setSelected(0);
      }
    },
    [mode],
  );

  const voice = useVoice({
    onTranscript: (text, final) => {
      setQuery(text);
      if (final && autoSubmit) runQuery(text);
    },
  });

  // Live search while typing; ask mode waits for Enter.
  useEffect(() => {
    if (mode === "search") runQuery(query, "search");
  }, [query, mode, runQuery]);

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
      const next = mode === "search" ? "ask" : "search";
      setMode(next);
      if (next === "ask") runQuery(query, "ask");
    } else if (e.key === "Enter" && mode === "ask") {
      runQuery(query, "ask");
    }
    // Enter / Ctrl+Enter on a result will open or reveal it once the indexer
    // can hand back real paths.
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
          placeholder={mode === "ask" ? "Ask anything about your files" : "Search files, photos, videos, recordings…"}
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

      {voice.listening && <VoiceBar level={voice.level} mode={voiceMode} />}

      <div className="launcher-body">
        {mode === "ask" ? (
          <AnswerPanel answer={answer} />
        ) : results.length ? (
          <>
            <ResultList results={results} selected={selected} onSelect={setSelected} />
            {current && <Preview result={current} />}
          </>
        ) : (
          <div className="launcher-empty">
            <Icon name="lock" size={18} />
            Type or hold the voice key to search. Everything stays on this PC.
          </div>
        )}
      </div>

      <footer className="launcher-footer">
        <span>{mode === "ask" ? "Answer built only from your files" : `${results.length} ${results.length === 1 ? "result" : "results"}`}</span>
        <span className="launcher-footer-keys">
          {current && mode === "search" && <span>Enter {openLabel(current)}</span>}
          <span>Ctrl+Enter Reveal</span>
          <span>Tab {mode === "ask" ? "Back to results" : "Ask"}</span>
          <span>Esc Close</span>
        </span>
      </footer>
    </div>
  );
}
