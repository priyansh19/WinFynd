import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { InfoBar } from "../../components/InfoBar";
import { SettingsCard } from "../../components/SettingsCard";
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
    <div className="cc-page-inner">
      <h1 className="cc-title">Overview</h1>
      <p className="cc-lead">
        WinFynd indexes new and changed files as they appear. Closing this window keeps it running in the notification area.
      </p>

      {status && status.ollama !== "ok" && (
        <InfoBar
          severity="warning"
          title="Search by meaning is off"
          action={
            <button type="button" className="btn" onClick={onOpenModels}>
              Set up models
            </button>
          }
        >
          {status.message ?? "WinFynd can't reach Ollama on this PC."} Exact words and file names still work.
        </InfoBar>
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

      <h2 className="cc-section">Indexed folders</h2>
      <div className="cc-stack">
        <SettingsCard
          icon="folderAdd"
          header="Add a folder"
          description="WinFynd watches these folders and everything inside them."
        >
          <button type="button" className="btn btn-accent" onClick={addFolder}>
            Add folder
          </button>
        </SettingsCard>
        {config?.roots.map((root) => (
          <SettingsCard key={root} icon="folderOpen" header={root.split(/[\\/]/).pop() || root} description={root}>
            <button
              type="button"
              className="btn"
              onClick={() => save({ ...config, roots: config.roots.filter((r) => r !== root) })}
            >
              Remove
            </button>
          </SettingsCard>
        ))}
        {config?.roots.length === 0 && (
          <SettingsCard icon="info" header="No folders yet" description="Add one to start indexing." />
        )}
        <SettingsCard
          icon="sync"
          header="Look for changes now"
          description="Changes are picked up automatically. Use this after copying in lots of files while WinFynd was closed."
        >
          <button type="button" className="btn" onClick={() => rescan()}>
            Rescan
          </button>
        </SettingsCard>
      </div>
      {error && <p className="cc-error">{error}</p>}
      <p className="cc-note">
        Hidden folders, app data, node_modules and build output are skipped. OneDrive files that are
        only in the cloud are indexed by name until they're downloaded.
      </p>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note && (
        <span className="stat-note" title={note}>
          {note}
        </span>
      )}
    </div>
  );
}
