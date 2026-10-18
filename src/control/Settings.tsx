import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "../components/Icon";
import { TitleBar } from "../components/TitleBar";
import { useEngineStatus } from "../lib/engine";
import { listen } from "../lib/tauri";
import { Corner } from "./Corner";
import { AboutPage } from "./pages/About";
import { FoldersPage } from "./pages/Folders";
import { HomePage } from "./pages/Home";
import { ModelsPage } from "./pages/Models";
import { PrivacyPage } from "./pages/Privacy";
import { ShortcutsPage } from "./pages/Shortcuts";

export type PageId = "home" | "folders" | "models" | "shortcuts" | "privacy" | "about";

/** The navigation, each with its own colour like Windows 11 Settings. */
const PAGES: { id: PageId; label: string; icon: IconName; k: string }[] = [
  { id: "home", label: "Home", icon: "home", k: "k-doc" },
  { id: "folders", label: "Folders", icon: "folder", k: "k-amber" },
  { id: "models", label: "Models", icon: "cube", k: "k-audio" },
  { id: "shortcuts", label: "Shortcuts & voice", icon: "keyboard", k: "k-code" },
  { id: "privacy", label: "Privacy", icon: "shield", k: "k-sheet" },
  { id: "about", label: "About", icon: "info", k: "k-other" },
];

/** Every setting "Find a setting" knows, with the words people might type for it. */
const FINDABLE: { label: string; page: PageId; words?: string }[] = [
  { label: "Pause reading files", page: "home", words: "pause indexing progress stop" },
  { label: "Allow full OS context", page: "folders", words: "whole pc computer every drive all files everything access" },
  { label: "Add a folder", page: "folders", words: "folder watch index directory choose" },
  { label: "What's in photos", page: "folders", words: "images pictures understand describe" },
  { label: "Speech in recordings and videos", page: "folders", words: "audio transcript whisper meeting" },
  { label: "Frames in videos", page: "folders", words: "ffmpeg video moment" },
  { label: "OneDrive files that are only online", page: "folders", words: "cloud onedrive download" },
  { label: "System and app folders", page: "folders", words: "skip exclude ignore node_modules hidden drive edit list" },
  { label: "Search model", page: "models", words: "embeddinggemma embedding ollama meaning" },
  { label: "Ask model", page: "models", words: "chat llama answers question" },
  { label: "Whisper", page: "models", words: "speech model download transcribe" },
  { label: "FFmpeg", page: "models", words: "video frames" },
  { label: "Index size", page: "models", words: "storage disk dimensions vector space" },
  { label: "Open search", page: "shortcuts", words: "hotkey shortcut alt space launcher keys" },
  { label: "Talk to search", page: "shortcuts", words: "voice hotkey push to talk speak" },
  { label: "Ask a question", page: "shortcuts", words: "hotkey shortcut ask answer" },
  { label: "Search selected text", page: "shortcuts", words: "hotkey shortcut selection highlight" },
  { label: "Microphone", page: "shortcuts", words: "mic input device headset" },
  { label: "How talking works", page: "shortcuts", words: "hold toggle press voice" },
  { label: "Connections", page: "privacy", words: "network internet online offline" },
  { label: "Remember recent searches", page: "privacy", words: "history clear recent" },
  { label: "Delete the index", page: "privacy", words: "reset remove data wipe" },
  { label: "Check for updates", page: "about", words: "version update release new" },
  { label: "Run setup again", page: "about", words: "onboarding welcome start over" },
  { label: "Report a problem", page: "about", words: "bug issue github feedback help" },
];

function matches(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return FINDABLE.filter((s) => `${s.label} ${s.words ?? ""}`.toLowerCase().includes(q)).slice(0, 7);
}

/** "Find a setting": type, pick one, and the page opens with that setting lit up. */
function FindSetting({ onPick }: { onPick: (label: string, page: PageId) => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // The list covers the navigation, so it shows only while the box has focus.
  const [open, setOpen] = useState(false);
  const found = useMemo(() => matches(query), [query]);
  const pick = (i: number) => {
    const s = found[i];
    if (!s) return;
    onPick(s.label, s.page);
    setQuery("");
  };
  return (
    <div className="navsearch-wrap">
      <label className="navsearch">
        <input
          value={query}
          placeholder="Find a setting"
          aria-label="Find a setting"
          role="combobox"
          aria-expanded={open && found.length > 0}
          aria-controls="setting-matches"
          spellCheck={false}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, found.length - 1));
            else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
            else if (e.key === "Enter") pick(active);
            else if (e.key === "Escape") setQuery("");
            else return;
            e.preventDefault();
          }}
        />
        <Icon name="search" size={14} />
      </label>
      {open && query.trim() && (
        <div className="menu navsearch-menu" role="listbox" id="setting-matches">
          {found.length ? (
            found.map((s, i) => (
              <button
                key={s.label}
                type="button"
                role="option"
                aria-selected={i === active}
                className="menu-item"
                data-active={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(i)}
              >
                <span className="menu-item-label">{s.label}</span>
                <span className="menu-item-key">{PAGES.find((p) => p.id === s.page)?.label}</span>
              </button>
            ))
          ) : (
            <span className="navsearch-none">No setting matches that</span>
          )}
        </div>
      )}
    </div>
  );
}

/** The Settings window: a coloured navigation pane with the live corner, and one page at a time. */
export function Settings() {
  const [page, setPage] = useState<PageId>("home");
  const [focus, setFocus] = useState<string | null>(null);
  const status = useEngineStatus();
  const main = useRef<HTMLElement>(null);

  const go = useCallback((next: PageId, setting: string | null = null) => {
    setPage(next);
    setFocus(setting);
  }, []);

  // The launcher's "Add a folder to search" and "Set up models" open a page here.
  useEffect(() => {
    const off = listen<string>("settings://page", (p) => PAGES.some((x) => x.id === p) && go(p as PageId));
    return () => {
      off.then((f) => f());
    };
  }, [go]);

  useLayoutEffect(() => {
    const root = main.current;
    root?.scrollTo({ top: 0 });
    if (!focus || !root) return;
    const find = () => root.querySelector<HTMLElement>(`[data-setting="${CSS.escape(focus)}"]`);
    const show = (el: HTMLElement) => {
      el.scrollIntoView({ block: "center" });
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
    };
    const el = find();
    if (el) {
      show(el);
      return;
    }
    // Most pages draw nothing until their settings load, so wait a moment for the setting to appear.
    const observer = new MutationObserver(() => {
      const el = find();
      if (!el) return;
      observer.disconnect();
      show(el);
    });
    observer.observe(root, { childList: true, subtree: true });
    const giveUp = window.setTimeout(() => observer.disconnect(), 2000);
    return () => {
      observer.disconnect();
      clearTimeout(giveUp);
    };
  }, [page, focus]);

  // Up and Down move between pages, as in a NavigationView.
  const onNavKey = (e: React.KeyboardEvent) => {
    const i = PAGES.findIndex((p) => p.id === page);
    const next = e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : -1;
    if (next < 0 || next >= PAGES.length) return;
    e.preventDefault();
    go(PAGES[next].id);
    (e.currentTarget.querySelectorAll("button")[next] as HTMLElement | undefined)?.focus();
  };

  return (
    <div className="settings">
      <TitleBar title="WinFynd Settings" />
      <div className="settings-body">
        <nav className="nav" aria-label="Settings sections">
          <FindSetting onPick={(label, p) => go(p, label)} />
          <div className="navitems" onKeyDown={onNavKey}>
            {PAGES.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`navitem${page === p.id ? " on" : ""}`}
                aria-current={page === p.id ? "page" : undefined}
                onClick={() => go(p.id)}
              >
                <Icon name={p.icon} size={20} className={`${p.k} kc`} />
                {p.label}
              </button>
            ))}
          </div>
          <Corner status={status} />
        </nav>
        <main className="content" ref={main}>
          <div className="page page-enter" key={page}>
            {page === "home" && <HomePage status={status} go={go} />}
            {page === "folders" && <FoldersPage status={status} />}
            {page === "models" && <ModelsPage />}
            {page === "shortcuts" && <ShortcutsPage />}
            {page === "privacy" && <PrivacyPage />}
            {page === "about" && <AboutPage />}
          </div>
        </main>
      </div>
    </div>
  );
}
