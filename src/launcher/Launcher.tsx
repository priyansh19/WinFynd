import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Keys } from "../components/Keycap";
import { Menu, type MenuItem } from "../components/Menu";
import { useEngineConfig, useEngineStatus } from "../lib/engine";
import { getHotkeys, type HotkeyConfig } from "../lib/hotkeys";
import { countByKind } from "../lib/kinds";
import { isTimestamp } from "../lib/match";
import { useFitWindowHeight } from "../lib/native";
import { recentSearches, rememberSearch } from "../lib/recent";
import {
  ask,
  groupResults,
  openResult,
  PHOTO_GRID_MIN,
  revealResult,
  search,
  withoutPhrase,
  type Answer,
  type FilterChip,
  type SearchResult,
} from "../lib/search";
import { invoke, listen } from "../lib/tauri";
import { AnswerPanel, answerAsText } from "./AnswerPanel";
import { NothingFound, Notes } from "./EmptyState";
import { Preview, type PreviewControls } from "./Preview";
import { ResultList } from "./ResultList";
import { VoiceBar, useVoice } from "./Voice";

type Mode = "search" | "ask";
type MenuAt = { right: number; bottom: number } | { left: number; top: number };
/** `open`: Enter was pressed before these results came in, so the top one opens when they do. */
type Found = { query: string; hits: SearchResult[]; ms: number; semantic: boolean; filters: FilterChip[]; open: boolean };
type Asked = { question: string; answer: Answer; seconds: number };
/** `toggles`: the button opens and closes the actions menu. */
type Action = { label: string; keys: string[]; run: () => void; toggles?: boolean };

const DEFAULT_KEYS: HotkeyConfig = {
  launcher: "Alt+Space",
  voice: "Alt+Shift+Space",
  ask: "Alt+Shift+A",
  selection: "Alt+Shift+F",
  voiceMode: "hold",
  autoSubmit: true,
};
const GRID_COLUMNS = 3;

/** Recordings and matched video moments play in place; everything else opens. */
const plays = (r: SearchResult) => (r.kind === "audio" || r.kind === "video") && isTimestamp(r.location);

function Footer({ left, actions }: { left: React.ReactNode; actions: Action[] }) {
  return (
    <footer className="lfoot">
      <span className="grow num" role="status">
        {left}
      </span>
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          className="act"
          onMouseDown={(e) => {
            e.preventDefault();
            // The menu closes on any press outside it, and the click would then open it again.
            if (a.toggles) e.stopPropagation();
          }}
          onClick={a.run}
        >
          {a.label} <Keys keys={a.keys} />
        </button>
      ))}
    </footer>
  );
}

export function Launcher() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("search");
  const [found, setFound] = useState<Found | null>(null);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState(0);
  const [asked, setAsked] = useState<Asked | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [voiceByClick, setVoiceByClick] = useState(false);
  const [keys, setKeys] = useState<HotkeyConfig>(DEFAULT_KEYS);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const controls = useRef<PreviewControls>({});
  const latest = useRef(0);
  const latestAsk = useRef(0);
  const debounce = useRef(0);
  const recall = useRef(-1);
  const status = useEngineStatus();
  const [config] = useEngineConfig();
  useFitWindowHeight(root);

  const runSearch = useCallback(async (q: string, open = false) => {
    const id = ++latest.current;
    if (!q.trim()) {
      setFound(null);
      setPending(false);
      return;
    }
    setPending(true);
    const started = performance.now();
    try {
      const r = await search(q);
      if (id !== latest.current) return; // a newer keystroke won
      // Keep the list in the order it's shown, so the arrow keys follow it.
      const hits = groupResults(r.hits).flatMap((g) => g.items);
      setFound({ query: q, hits, ms: Math.round(performance.now() - started), semantic: r.semantic, filters: r.filters, open });
      setSelected(0);
      setError(null);
    } catch (e) {
      if (id === latest.current) setError(String(e));
    } finally {
      if (id === latest.current) setPending(false);
    }
  }, []);

  const runAsk = useCallback(async (q: string) => {
    if (!q.trim()) return;
    const id = ++latestAsk.current;
    setAsking(true);
    setAsked(null);
    setError(null);
    const started = performance.now();
    try {
      const answer = await ask(q);
      if (id !== latestAsk.current) return; // asked again while this one was thinking
      setAsked({ question: q, answer, seconds: (performance.now() - started) / 1000 });
      rememberSearch(q);
    } catch (e) {
      if (id === latestAsk.current) setError(String(e));
    } finally {
      if (id === latestAsk.current) setAsking(false);
    }
  }, []);

  // Search as you type, lightly debounced so each keystroke doesn't embed.
  useEffect(() => {
    if (mode !== "search") return;
    debounce.current = window.setTimeout(() => runSearch(query), 120);
    return () => clearTimeout(debounce.current);
  }, [query, mode, runSearch]);

  const voice = useVoice({
    onDone: (text) => {
      if (!text) {
        setVoiceNote(
          voiceByClick
            ? "Didn't catch anything. Click the mic, say what you're looking for, then press Enter."
            : keys.voiceMode === "toggle"
              ? "Didn't catch anything. Press the voice keys, say what you're looking for, then press them again."
              : "Didn't catch anything. Hold the voice keys, say what you're looking for, then let go.",
        );
        return;
      }
      setQuery(text);
      if (mode === "ask" && keys.autoSubmit) runAsk(text);
    },
    onError: setError,
  });

  const switchMode = useCallback((next: Mode) => {
    setMode(next);
    setError(null);
    setMenu(null);
    input.current?.focus();
  }, []);

  // Global hotkeys arrive as events; read the newest state through a ref so
  // the listeners are set up once.
  const onEvent = useRef({ press: () => {}, release: () => {}, away: () => {} });
  onEvent.current = {
    press: () => {
      setVoiceNote(null);
      setVoiceByClick(false);
      if (voice.state === "off") voice.start();
      else if (keys.voiceMode === "toggle") voice.stop();
    },
    release: () => voice.stop(),
    away: () => {
      if (voice.state !== "off") voice.cancel();
    },
  };

  // The launcher hides when it loses focus or Alt+Space closes it. Stop
  // listening then, rather than recording (and maybe asking) behind a hidden
  // window: click and toggle modes have no key release that would end it.
  useEffect(() => {
    const away = () => onEvent.current.away();
    const hidden = () => {
      if (document.hidden) away();
    };
    window.addEventListener("blur", away);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", away);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);

  useEffect(() => {
    const refreshKeys = () =>
      getHotkeys()
        .then(({ config }) => setKeys(config))
        .catch(() => {});
    refreshKeys();
    const subs = [
      listen("launcher://shown", () => {
        refreshKeys();
        setMenu(null);
        recall.current = -1;
        input.current?.focus();
        input.current?.select();
      }),
      listen("launcher://ask", () => switchMode("ask")),
      // The text selected in the app in front, when that app shares it.
      listen<string | null>("launcher://selection", (text) => {
        switchMode("search");
        if (text) setQuery(text);
      }),
      // Setup's "Try one of these": the search typed in for the user, or the question asked.
      listen<{ text: string; ask: boolean }>("launcher://query", ({ text, ask: asking }) => {
        switchMode(asking ? "ask" : "search");
        setQuery(text);
        if (asking) runAsk(text);
      }),
      listen("voice://press", () => onEvent.current.press()),
      listen("voice://release", () => onEvent.current.release()),
    ];
    return () => subs.forEach((p) => p.then((off) => off()));
  }, [switchMode, runAsk]);

  // A short confirmation, like "Path copied", in the footer.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2000);
    return () => clearTimeout(t);
  }, [notice]);

  const hits = found && query.trim() ? found.hits : [];
  const current = mode === "search" ? hits[selected] : undefined;
  const groups = useMemo(() => groupResults(hits), [hits]);

  const hide = () => invoke("hide_launcher_cmd").catch(() => {});
  const fail = (e: unknown) => setError(String(e));
  const open = (r?: SearchResult) => {
    if (!r) return;
    rememberSearch(query);
    openResult(r.path).catch(fail);
  };
  const reveal = (r?: SearchResult) => {
    if (!r) return;
    rememberSearch(query);
    revealResult(r.path).catch(fail);
  };
  const primary = (r?: SearchResult) => {
    if (r && plays(r) && controls.current.play) {
      rememberSearch(query);
      controls.current.play();
    } else open(r);
  };
  const copy = (text: string, done: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => setNotice(done))
      .catch(fail);
  const openSource = (n: number) => {
    const s = asked?.answer.sources.find((x) => x.n === n);
    if (s) openResult(s.path).catch(fail);
  };

  // Enter came before the results did: open the top one now that it's on
  // screen (so a recording's preview is there to play), unless the box moved on.
  useEffect(() => {
    if (found?.open && found.query === query && mode === "search") primary(found.hits[0]);
  }, [found]);

  const primaryLabel = current && plays(current) ? `Play from ${current.location}` : "Open";
  const actions: MenuItem[] = current
    ? [
        { label: primaryLabel, icon: plays(current) ? "play" : "open", shortcut: "Enter", run: () => primary(current) },
        ...(plays(current) ? [{ label: "Open in its app", icon: "open" as const, run: () => open(current) }] : []),
        { label: "Open folder", icon: "folder", shortcut: "Ctrl+Shift+E", run: () => reveal(current) },
        { label: "Copy as path", icon: "copy", shortcut: "Ctrl+Shift+C", run: () => copy(current.path, "Path copied") },
      ]
    : [];

  /** Up and Down through the list; in the photo grid they move a row at a time. */
  const step = (by: 1 | -1) => {
    const n = hits.length;
    let start = 0;
    for (const g of groups) {
      const end = start + g.items.length;
      const grid = g.key === "image" && g.items.length >= PHOTO_GRID_MIN;
      if (grid && selected >= start && selected < end) {
        const target = selected + by * GRID_COLUMNS;
        if (target >= start && target < end) return target;
        const lastRow = start + Math.floor((end - 1 - start) / GRID_COLUMNS) * GRID_COLUMNS;
        if (by === 1 && selected < lastRow) return end - 1;
        break;
      }
      start = end;
    }
    return (selected + by + n) % n;
  };

  /** The box still holds the search Up last brought back. */
  const recalled = () => recall.current >= 0 && query === recentSearches()[recall.current];

  const onQueryChange = (value: string) => {
    recall.current = -1;
    setVoiceNote(null);
    setQuery(value);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (e.key === "Escape") {
      if (voice.state !== "off") voice.cancel();
      else if (mode === "ask") switchMode("search");
      else if (query) {
        recall.current = -1;
        setQuery("");
      } else hide();
    } else if (e.key === "Tab") {
      switchMode(mode === "ask" ? "search" : "ask");
    } else if (voice.state === "listening" && e.key === "Enter") {
      voice.stop();
    } else if (mode === "ask") {
      if (e.key === "Enter") runAsk(query);
      else if (asked && e.ctrlKey && e.shiftKey && key === "c") copy(answerAsText(asked.answer), "Answer copied");
      else if (asked && e.ctrlKey && /^[1-9]$/.test(e.key)) openSource(Number(e.key));
      else return;
    } else if (e.key === "ArrowUp" && (!query || ((selected === 0 || !hits.length) && recalled()))) {
      // Up in an empty box brings back recent searches, newest first. From
      // the top of the list it keeps going back while the box holds one.
      const recent = recentSearches();
      if (!recent.length) return;
      recall.current = Math.min(recall.current + 1, recent.length - 1);
      setQuery(recent[recall.current]);
    } else if (hits.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setSelected(step(e.key === "ArrowDown" ? 1 : -1));
    } else if (hits.length && (e.key === "PageDown" || e.key === "PageUp")) {
      const by = e.key === "PageDown" ? 5 : -5;
      setSelected((i) => Math.max(0, Math.min(hits.length - 1, i + by)));
    } else if (e.key === "Enter" && (e.ctrlKey || e.shiftKey)) {
      reveal(current);
    } else if (e.key === "Enter") {
      if (found?.query === query) primary(current);
      else if (query.trim()) {
        // Typed and pressed Enter before the results caught up: what's on
        // screen is for the old text, so search now and open when it lands.
        clearTimeout(debounce.current);
        runSearch(query, true);
      }
    } else if (e.ctrlKey && e.shiftKey && key === "e") {
      reveal(current);
    } else if (e.ctrlKey && e.shiftKey && key === "c") {
      if (current) copy(current.path, "Path copied");
    } else if (current && ((e.ctrlKey && key === "k") || (e.shiftKey && e.key === "F10") || e.key === "ContextMenu")) {
      setMenu({ right: 12, bottom: 44 });
    } else {
      return;
    }
    e.preventDefault();
  };

  const talking = voice.state !== "off";
  const searching = mode === "search" && query.trim().length > 0;
  const settled = !!found && found.query === query && !pending;
  const nothing = searching && settled && hits.length === 0;
  const busy = pending || asking || voice.state === "transcribing";
  const filters = mode === "search" && query.trim() ? (found?.filters ?? []) : [];

  const summary = (() => {
    if (!found) return "";
    const photosLead = groups[0]?.key === "image" && groups[0].items.length >= PHOTO_GRID_MIN;
    const count = photosLead ? countByKind(hits.map((h) => h.kind)) : `${hits.length} ${hits.length === 1 ? "result" : "results"}`;
    return `${count} · ${found.ms} ms${found.semantic ? "" : " · exact words only"}`;
  })();
  const left = notice ? (
    <span className="notice">
      <Icon name="check" size={14} strokeWidth={2} />
      {notice}
    </span>
  ) : null;

  // The words heard so far; the last one stays faint until Whisper settles on it.
  const heard = (() => {
    if (!voice.heard) return <span className="faint">Say what you're looking for</span>;
    if (voice.state === "transcribing") return voice.heard;
    const at = voice.heard.lastIndexOf(" ");
    return at < 0 ? (
      <span className="faint">{voice.heard}</span>
    ) : (
      <>
        {voice.heard.slice(0, at + 1)}
        <span className="faint">{voice.heard.slice(at + 1)}</span>
      </>
    );
  })();

  return (
    <div ref={root} className="launcher" tabIndex={-1 /* a click on text focuses this, not the page, so the keys keep working */} onKeyDown={onKeyDown}>
      <div className={`lsearch${mode === "ask" ? " ask" : ""}`}>
        {talking ? (
          <span className="mic">
            <Icon name="mic" size={16} strokeWidth={1.8} />
          </span>
        ) : (
          <Icon name={mode === "ask" ? "sparkle" : "search"} size={20} style={{ flex: "none" }} />
        )}
        {talking && <div className="heard">{heard}</div>}
        <input
          ref={input}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          className={talking ? "offstage" : undefined}
          aria-label={mode === "ask" ? "Ask a question about your files" : "Search your files"}
          aria-expanded={mode === "search" && hits.length > 0}
          aria-controls="results"
          aria-activedescendant={current ? `result-${selected}` : undefined}
          placeholder={mode === "ask" ? "Ask a question about your files" : "Search files, photos and recordings"}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {filters.map((f) => (
          <button
            key={f.label}
            type="button"
            className="lchip"
            title={`Search everything, not just ${f.label.toLowerCase()}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setQuery(withoutPhrase(query, f.phrase))}
          >
            {f.label}
            <Icon name="close" size={12} />
          </button>
        ))}
        <button
          type="button"
          className={`lbtn${mode === "ask" ? " on" : ""}`}
          aria-pressed={mode === "ask"}
          title="Ask a question about your files"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => switchMode(mode === "ask" ? "search" : "ask")}
        >
          <Icon name="sparkle" />
          Ask
          <kbd className="kbd">Tab</kbd>
        </button>
        {!talking && (
          <button
            type="button"
            className="lbtn"
            aria-label="Search by voice"
            title="Search by voice"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setVoiceNote(null);
              setVoiceByClick(true);
              voice.start();
            }}
          >
            <Icon name="mic" />
          </button>
        )}
        {talking && voiceByClick && (
          <button type="button" className="lbtn on" aria-label="Stop and search" onMouseDown={(e) => e.preventDefault()} onClick={() => voice.stop()}>
            <Icon name="mic" />
          </button>
        )}
        {(searching || mode === "ask" || talking) && <div className={`lline${busy ? " busy" : ""}`} />}
      </div>

      {error && (
        <div className="lerror" role="alert">
          <Icon name="error" size={16} />
          <span className="selectable">{error}</span>
        </div>
      )}

      {talking ? (
        <VoiceBar state={voice.state} level={voice.level} mode={keys.voiceMode} accelerator={keys.voice} byClick={voiceByClick} />
      ) : mode === "ask" ? (
        <>
          <AnswerPanel answer={asked?.answer ?? null} loading={asking} seconds={asked?.seconds ?? null} onOpen={(p) => openResult(p).catch(fail)} />
          <Footer
            left={left ?? "Ask"}
            actions={
              asked
                ? [
                    { label: "Copy answer", keys: ["Ctrl", "Shift", "C"], run: () => copy(answerAsText(asked.answer), "Answer copied") },
                    { label: "Open source", keys: ["Ctrl", "1"], run: () => openSource(1) },
                    { label: "Back to results", keys: ["Esc"], run: () => switchMode("search") },
                  ]
                : [
                    { label: "Ask", keys: ["Enter"], run: () => runAsk(query) },
                    { label: "Back to results", keys: ["Esc"], run: () => switchMode("search") },
                  ]
            }
          />
        </>
      ) : hits.length > 0 ? (
        <>
          <div className="lbody">
            <ResultList
              results={hits}
              selected={selected}
              query={found?.query ?? query}
              onSelect={setSelected}
              onOpen={(i) => primary(hits[i])}
              onContextMenu={(i, x, y) => {
                setSelected(i);
                setMenu({ left: Math.min(x, window.innerWidth - 240), top: Math.min(y, window.innerHeight - 160) });
              }}
            />
            {current && <Preview result={current} query={found?.query ?? query} controls={controls} speechModel={config?.speechModel} />}
          </div>
          <Footer
            left={left ?? summary}
            actions={[
              { label: primaryLabel, keys: ["Enter"], run: () => primary(current) },
              { label: "Open folder", keys: ["Ctrl", "Shift", "E"], run: () => reveal(current) },
              { label: "All actions", keys: ["Ctrl", "K"], run: () => setMenu(menu ? null : { right: 12, bottom: 44 }), toggles: true },
            ]}
          />
        </>
      ) : nothing ? (
        <>
          <NothingFound
            roots={config?.roots ?? []}
            onAsk={() => {
              switchMode("ask");
              runAsk(query);
            }}
          />
          <Footer
            left={summary}
            actions={[
              { label: "Ask", keys: ["Tab"], run: () => switchMode("ask") },
              { label: "Close", keys: ["Esc"], run: hide },
            ]}
          />
        </>
      ) : (
        !searching && <Notes status={status} />
      )}

      {voiceNote && !talking && (
        <div className="lnote" role="status">
          <Icon name="mic" size={16} />
          <span className="grow">{voiceNote}</span>
        </div>
      )}

      {menu && actions.length > 0 && <Menu label="Actions" items={actions} style={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
