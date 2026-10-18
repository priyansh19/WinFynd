import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { Keys, KeyCombo } from "../../components/Keycap";
import { formatBytes, isBusy, listModels, rescan, useEngineConfig, useTimeLeft, type EngineStatus, type InstalledModel } from "../../lib/engine";
import { getHotkeys, type HotkeyConfig } from "../../lib/hotkeys";
import { KINDS, timeLeft, totalOf } from "../../lib/kinds";
import { pauseIndexing, useIndexStats } from "../../lib/stats";
import type { PageId } from "../Settings";

const FIRST_DONE = "wf.firstIndexDone";

function firstIndexDone(): boolean {
  try {
    return localStorage.getItem(FIRST_DONE) === "1";
  } catch {
    return true;
  }
}

/** The spectrum ring filled to `pct`, as a conic gradient behind the ring mask. */
export function ProgressRing({ pct, size = 88, children }: { pct: number; size?: number; children?: React.ReactNode }) {
  const deg = Math.round(Math.max(0, Math.min(100, pct)) * 3.6);
  const fill =
    deg >= 360
      ? "var(--spectrum-ring)"
      : `conic-gradient(#5b9bff 0deg, #9a7bff ${Math.round(deg * 0.36)}deg, #ff6fb5 ${Math.round(deg * 0.7)}deg, #ff9548 ${deg}deg, var(--track) ${deg}deg)`;
  return (
    <div className="ringbox" style={{ width: size, height: size }}>
      <div className="ring" style={{ width: size, height: size, background: fill }} />
      <span className="ringlabel">{children}</span>
    </div>
  );
}

export const folderName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

const clock = (unix: number) => new Date(unix * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export function HomePage({ status, go }: { status: EngineStatus | null; go: (page: PageId, setting?: string | null) => void }) {
  const busy = isBusy(status);
  const paused = status?.state === "paused";
  const stats = useIndexStats(busy);
  const [config] = useEngineConfig();
  const [keys, setKeys] = useState<HotkeyConfig | null>(null);
  const [models, setModels] = useState<{ installed: InstalledModel[] | null; error: string | null } | null>(null);
  const left = useTimeLeft(status);
  const [firstTime] = useState(() => !firstIndexDone());

  useEffect(() => {
    getHotkeys()
      .then((h) => setKeys(h.config))
      .catch(() => {});
    listModels()
      .then(setModels)
      .catch(() => {});
  }, []);

  // Remember when the first full index finishes, so later passes don't say "for the first time".
  useEffect(() => {
    if (status && !busy && status.files > 0) {
      try {
        localStorage.setItem(FIRST_DONE, "1");
      } catch {
        // Not remembered; the wording just stays as it is.
      }
    }
  }, [status, busy]);

  const total = status ? status.files + status.queued : 0;
  const pct = total ? Math.floor((status!.files / total) * 100) : 100;
  const kinds = stats?.kinds ?? {};
  const kindTotal = totalOf(kinds);
  const roots = config?.roots ?? [];
  const embed = models?.installed?.find((m) => m.name === config?.embedModel || m.name === `${config?.embedModel}:latest`);

  return (
    <>
      <h1 className="h1">Home</h1>

      {status && status.ollama !== "ok" && status.state !== "loading" && (
        <div className="infobar warning" style={{ marginBottom: 12 }}>
          <Icon name="warning" size={16} />
          <span className="grow">
            <strong>Search by meaning is off.</strong>{" "}
            <span className="muted">
              {status.ollama === "offline" ? "Ollama isn't running on this PC." : "The search model isn't downloaded yet."} File names and exact words still
              work.
            </span>
          </span>
          <button type="button" className="btn" onClick={() => go("models")}>
            Set up models
          </button>
        </div>
      )}

      <div className={`panel hero${busy ? "" : " ready"}`} data-setting="Pause reading files">
        {busy ? (
          <ProgressRing pct={pct}>
            <span className="num">{pct}%</span>
          </ProgressRing>
        ) : (
          <ProgressRing pct={100}>
            <Icon name="check" size={32} strokeWidth={2.2} className="ring-check" />
          </ProgressRing>
        )}
        <div className="hero-text">
          {paused ? (
            <>
              <span className="hero-title">Reading is paused</span>
              <span className="muted num">
                {status!.files.toLocaleString()} of {total.toLocaleString()} files{status!.pausedUntil ? ` · resumes at ${clock(status!.pausedUntil)}` : ""}
              </span>
              <span className="small faint">You can search what's been read so far.</span>
            </>
          ) : busy ? (
            <>
              <span className="hero-title">{firstTime ? "Reading your files for the first time" : "Reading new and changed files"}</span>
              <span className="muted num">
                {status!.queued > 0 ? `${status!.files.toLocaleString()} of ${total.toLocaleString()} files` : "Looking through your folders"}
                {timeLeft(left) && ` · ${timeLeft(left)}`}
              </span>
              <span className="small faint">You can search already. Results fill in as it goes.</span>
            </>
          ) : (
            <>
              <span className="hero-title">Everything is ready to search</span>
              <span className="muted num">
                {(status?.files ?? 0).toLocaleString()} files from {roots.length} {roots.length === 1 ? "folder" : "folders"}
              </span>
              <span className="small faint">New and changed files are read within seconds of being saved.</span>
            </>
          )}
        </div>
        {paused ? (
          <button type="button" className="btn" onClick={() => pauseIndexing(0)}>
            <Icon name="play" size={14} />
            Resume now
          </button>
        ) : busy ? (
          <button type="button" className="btn" onClick={() => pauseIndexing(60)}>
            <Icon name="pause" size={14} />
            Pause for an hour
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => rescan()}>
            <Icon name="refresh" size={14} />
            Look for changes
          </button>
        )}
      </div>

      <h2 className="h2">On this PC</h2>
      <div className="panel onpc">
        <div className={`kindbar${kindTotal ? "" : " empty"}`} style={{ height: 10, borderRadius: 5 }} role="img" aria-label="Files by kind">
          {KINDS.map(({ kind, cls }) => (kinds[kind] ? <i key={kind} className={cls} style={{ flex: kinds[kind] }} /> : null))}
        </div>
        <div className="legend">
          {KINDS.map(({ kind, cls, label }) => (
            <div key={kind} className={cls}>
              <span className="dot" />
              <span className="muted">{label}</span>
              <span className="num">{(kinds[kind] ?? 0).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      <h2 className="h2">Quick settings</h2>
      <div className="quick">
        <button type="button" className="card" onClick={() => go("folders")}>
          <Icon name="folder" size={20} className="k-amber kc" />
          <span className="grow">
            <span className="t">
              {roots.length} {roots.length === 1 ? "folder" : "folders"} watched
            </span>
            <span className="s ellip">{roots.length ? roots.map(folderName).join(", ") : "Add one to start"}</span>
          </span>
        </button>
        <button type="button" className="card" onClick={() => go("shortcuts")}>
          <Icon name="keyboard" size={20} className="k-code kc" />
          <span className="grow">
            <span className="t">Open search with {keys ? <KeyCombo accelerator={keys.launcher} /> : <Keys keys={["Alt", "Space"]} />}</span>
            <span className="s">
              {keys?.voiceMode === "toggle" ? "Press" : "Hold"} {keys ? <KeyCombo accelerator={keys.voice} /> : <Keys keys={["Alt", "Shift", "Space"]} />} to talk
            </span>
          </span>
        </button>
        <button type="button" className="card" onClick={() => go("models")}>
          <Icon name="cube" size={20} className="k-audio kc" />
          <span className="grow">
            <span className="t">
              {models?.error ? "Ollama isn't running" : embed ? "EmbeddingGemma 2 is ready" : models ? "EmbeddingGemma 2 isn't downloaded" : "EmbeddingGemma 2"}
            </span>
            <span className="s">
              {config?.indexImages ? "Text and photos" : "Text"}
              {embed ? ` · ${formatBytes(embed.size)}` : ""}
            </span>
          </span>
        </button>
      </div>
    </>
  );
}
