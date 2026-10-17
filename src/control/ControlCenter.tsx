import { useState } from "react";
import { HotkeysPage } from "./pages/Hotkeys";
import { ModelsPage } from "./pages/Models";
import { OverviewPage } from "./pages/Overview";

const PAGES = [
  { id: "overview", label: "Overview" },
  { id: "models", label: "Models" },
  { id: "hotkeys", label: "Hotkeys & voice" },
] as const;

type PageId = (typeof PAGES)[number]["id"];

export function ControlCenter() {
  const [page, setPage] = useState<PageId>("models");

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
        <div className="cc-index-status">
          <div className="cc-index-title">
            <span className="dot-idle" aria-hidden="true" />
            Indexer not connected
          </div>
          <span className="cc-muted">Counts appear once the indexer is connected</span>
        </div>
      </nav>
      <main className="cc-main">
        {page === "overview" && <OverviewPage />}
        {page === "models" && <ModelsPage />}
        {page === "hotkeys" && <HotkeysPage />}
      </main>
    </div>
  );
}
