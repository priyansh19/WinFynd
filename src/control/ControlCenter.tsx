import { useState } from "react";
import { useEngineStatus } from "../lib/engine";
import { HotkeysPage } from "./pages/Hotkeys";
import { ModelsPage } from "./pages/Models";
import { OverviewPage } from "./pages/Overview";

const PAGES = [
  { id: "overview", label: "Overview" },
  { id: "models", label: "Models" },
  { id: "hotkeys", label: "Hotkeys & voice" },
] as const;

type PageId = (typeof PAGES)[number]["id"];

const STATE_LABEL = { idle: "Up to date", scanning: "Looking for changes", indexing: "Indexing", error: "Indexing stopped" };

export function ControlCenter() {
  const [page, setPage] = useState<PageId>("overview");
  const status = useEngineStatus();

  return (
    <div className="cc">
      <nav className="cc-nav" aria-label="Sections">
        <div className="cc-brand">
          <span className="cc-logo" aria-hidden="true" />
          WinFynd
        </div>
        {PAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            className="cc-nav-item"
            aria-current={page === p.id ? "page" : undefined}
            onClick={() => setPage(p.id)}
          >
            {p.label}
          </button>
        ))}
        {status && (
          <div className="cc-index-status" role="status">
            <div className="cc-index-title">
              <span className={status.ollama === "ok" ? "dot-ok" : "dot-warn"} aria-hidden="true" />
              {STATE_LABEL[status.state]}
            </div>
            <span className="cc-muted">
              {status.files.toLocaleString()} files
              {status.queued > 0 && ` · ${status.queued.toLocaleString()} to go`}
            </span>
            {status.ollama !== "ok" && <span className="cc-muted">Search by meaning is off</span>}
          </div>
        )}
      </nav>
      <main className="cc-main">
        {page === "overview" && <OverviewPage status={status} onOpenModels={() => setPage("models")} />}
        {page === "models" && <ModelsPage />}
        {page === "hotkeys" && <HotkeysPage />}
      </main>
    </div>
  );
}
