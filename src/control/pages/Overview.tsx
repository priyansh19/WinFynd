import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getConfig, rescan, setConfig, type EngineConfig, type EngineStatus } from "../../lib/engine";
import { inTauri } from "../../lib/tauri";

export function OverviewPage({ status, onOpenModels }: { status: EngineStatus | null; onOpenModels: () => void }) {
  const [config, setLocal] = useState<EngineConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getConfig().then(setLocal);
  }, []);

  const save = async (next: EngineConfig) => {
    try {
      setLocal(await setConfig(next));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const addFolder = async () => {
    if (!config || !inTauri) return;
    const picked = await open({ directory: true, multiple: false, title: "Choose a folder to index" });
    if (typeof picked === "string" && !config.roots.includes(picked)) {
      save({ ...config, roots: [...config.roots, picked] });
    }
  };

  return (
    <>
      <header className="cc-header">
        <h1>Overview</h1>
        <p>WinFynd indexes new and changed files as they appear. Closing this window keeps it running in the tray.</p>
      </header>

      {status && status.ollama !== "ok" && (
        <div className="card notice" role="alert">
          <div className="list-text">
            <span className="list-title">Search by meaning is off</span>
            <span className="cc-muted">{status.message ?? "WinFynd can't reach Ollama on this PC."} Exact-word and file-name search still work.</span>
          </div>
          <button type="button" className="btn btn-primary" onClick={onOpenModels}>
            Set up models
          </button>
        </div>
      )}

      <div className="stat-grid">
        <Stat label="Files indexed" value={status ? status.files.toLocaleString() : "…"} />
        <Stat label="Passages and images" value={status ? status.chunks.toLocaleString() : "…"} />
        <Stat
          label="Right now"
          value={status ? (status.queued > 0 ? `${status.queued.toLocaleString()} to index` : "Up to date") : "…"}
          note={status?.current ?? undefined}
        />
      </div>

      <div className="section-head">
        <h2 className="cc-subhead">Indexed folders</h2>
        <div className="section-actions">
          <button type="button" className="btn" onClick={() => rescan()}>
            Rescan now
          </button>
          <button type="button" className="btn btn-primary" onClick={addFolder}>
            Add folder
          </button>
        </div>
      </div>
      {error && <span className="text-danger">{error}</span>}
      <div className="card list">
        {config?.roots.length === 0 && (
          <div className="list-row">
            <span className="cc-muted">No folders yet. Add one to start indexing.</span>
          </div>
        )}
        {config?.roots.map((root) => (
          <div key={root} className="list-row">
            <div className="list-text">
              <span className="list-title">{root.split(/[\\/]/).pop()}</span>
              <span className="cc-muted">{root}</span>
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => save({ ...config, roots: config.roots.filter((r) => r !== root) })}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      {status && status.unreadable > 0 && (
        <p className="cc-muted">
          {status.unreadable.toLocaleString()} {status.unreadable === 1 ? "file" : "files"} couldn't be read and can be
          found by name only.
        </p>
      )}
      <p className="cc-muted">
        Hidden folders, app data, node_modules and build output are skipped. OneDrive files that are only in the cloud are
        indexed by name until they're downloaded.
      </p>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card stat">
      <span className="cc-muted">{label}</span>
      <span className="stat-value">{value}</span>
      {note && <span className="cc-muted stat-note" title={note}>{note}</span>}
    </div>
  );
}
