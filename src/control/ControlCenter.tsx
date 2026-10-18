import { useState } from "react";
import { Icon, type IconName } from "../components/Icon";
import { ProgressBar } from "../components/Progress";
import { useEngineStatus } from "../lib/engine";
import { IndexingFeed } from "./IndexingFeed";
import { HotkeysPage } from "./pages/Hotkeys";
import { ModelsPage } from "./pages/Models";
import { OverviewPage } from "./pages/Overview";

const PAGES: { id: "overview" | "models" | "hotkeys"; label: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "models", label: "Models", icon: "models" },
  { id: "hotkeys", label: "Hotkeys & voice", icon: "keyboard" },
];

type PageId = (typeof PAGES)[number]["id"];

const STATE_LABEL = {
  loading: "Opening the index",
  idle: "Up to date",
  scanning: "Looking for changes",
  indexing: "Indexing",
  error: "Indexing stopped",
};

/** The Settings window, laid out like Windows Settings: a navigation pane and a page of settings cards. */
export function ControlCenter() {
  const [page, setPage] = useState<PageId>("overview");
  const status = useEngineStatus();

  // Up/Down move between pages, as in a NavigationView.
  const onNavKey = (e: React.KeyboardEvent) => {
    const i = PAGES.findIndex((p) => p.id === page);
    const next = e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : -1;
    if (next < 0 || next >= PAGES.length) return;
    e.preventDefault();
    setPage(PAGES[next].id);
    (e.currentTarget.querySelectorAll("button")[next] as HTMLElement | undefined)?.focus();
  };

  return (
    <div className="cc">
      <nav className="cc-nav" aria-label="Settings">
        <div className="cc-nav-items" onKeyDown={onNavKey}>
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              className="cc-nav-item"
              aria-current={page === p.id ? "page" : undefined}
              title={p.label}
              onClick={() => setPage(p.id)}
            >
              <Icon name={p.icon} size={16} />
              <span className="cc-nav-label">{p.label}</span>
            </button>
          ))}
        </div>
        {status && (
          <div className="cc-index-status" role="status">
            <span className="cc-index-title">
              <Icon
                name={status.state === "error" ? "error" : status.ollama === "ok" ? "success" : "warning"}
                size={16}
                className={status.state === "error" ? "is-error" : status.ollama === "ok" ? "is-ok" : "is-warning"}
              />
              {STATE_LABEL[status.state]}
            </span>
            <span className="cc-index-detail">
              {status.files.toLocaleString()} files
              {status.queued > 0 && ` · ${status.queued.toLocaleString()} to go`}
              {status.ollama !== "ok" && " · search by meaning is off"}
            </span>
            {status.queued > 0 && <ProgressBar label="Indexing" value={(status.files / (status.files + status.queued)) * 100} />}
            <IndexingFeed />
          </div>
        )}
      </nav>
      <main className="cc-page">
        {page === "overview" && <OverviewPage status={status} onOpenModels={() => setPage("models")} />}
        {page === "models" && <ModelsPage />}
        {page === "hotkeys" && <HotkeysPage />}
      </main>
    </div>
  );
}
