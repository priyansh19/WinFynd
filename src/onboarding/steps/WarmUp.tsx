import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { KeyCombo } from "../../components/Keycap";
import { formatBytes, listModels, useEngineStatus, type EngineStatus, type InstalledModel } from "../../lib/engine";
import { getHotkeys } from "../../lib/hotkeys";
import { finishOnboarding, openOllamaDownload, type AfterSetup, type FileActivity } from "../../lib/onboarding";
import { listen } from "../../lib/tauri";
import { Check, StepFooter, StepHeader, type StepProps } from "../Onboarding";

const IDEAS = ["the lease agreement I signed last spring", "photo of a birthday cake", "slides about the Q3 budget", "notes that mention the dentist"];

const KIND_LABEL: Record<string, string> = {
  document: "DOC", slides: "PPT", spreadsheet: "XLS", code: "CODE", image: "IMG", video: "VID", audio: "AUD", other: "FILE",
};

const has = (installed: InstalledModel[], name: string) => installed.some((m) => m.name === name || m.name === `${name}:latest`);
const pct = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : 0);

type Row = "done" | "busy" | "wait";

interface Drop {
  id: number;
  name: string;
  kind: string;
}

/**
 * Last step: the first download and index can take a while, so this shows
 * what's left and lets the user close the window while it finishes.
 */
export function WarmUpStep({ config, back, pull, startPull }: StepProps) {
  const status = useEngineStatus();
  const [installed, setInstalled] = useState<InstalledModel[] | null | undefined>(undefined);
  const [launcherKey, setLauncherKey] = useState<string | null>(null);
  const [drops, setDrops] = useState<Drop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const dropId = useRef(0);
  const sawActivity = useRef(false);

  useEffect(() => {
    getHotkeys().then((s) => setLauncherKey(s.config.launcher));
  }, []);

  // Check the model now and whenever a download finishes; poll while Ollama is missing.
  useEffect(() => {
    const check = () => listModels().then((m) => setInstalled(m.installed));
    check();
    if (installed !== null) return;
    const t = window.setInterval(check, 3000);
    return () => window.clearInterval(t);
  }, [pull?.done, installed === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const modelReady = installed ? has(installed, config.embedModel) : false;
  const downloading = pull && !pull.done && pull.model === config.embedModel ? pull : null;

  // The search model is part of warming up: start it if setup was skipped.
  useEffect(() => {
    if (started.current || !installed || modelReady || downloading) return;
    started.current = true;
    startPull(config.embedModel);
  }, [installed, modelReady, downloading, config.embedModel, startPull]);

  useEffect(() => {
    if (pull?.done && pull.error) setError(pull.error);
  }, [pull?.done, pull?.error]);

  // The small file feed: per-file events when the engine sends them, else the file being read now.
  const push = (name: string, kind: string) =>
    setDrops((d) => (d[0]?.name === name ? d : [{ id: ++dropId.current, name, kind }, ...d].slice(0, 3)));
  useEffect(() => {
    const off = listen<FileActivity>("engine://activity", (a) => {
      sawActivity.current = true;
      if (a.stage === "reading") push(a.name, a.kind);
    });
    return () => {
      off.then((f) => f());
    };
  }, []);
  useEffect(() => {
    if (sawActivity.current || !status?.current) return;
    const name = status.current.split(/[\\/]/).pop() ?? status.current;
    push(name, "other");
  }, [status?.current]);

  const indexing = isIndexing(status);
  const scanning = status?.state === "scanning";
  const total = status ? status.files + status.queued : 0;
  const ready = status !== null && !indexing && modelReady;

  const modelRow: Row = modelReady ? "done" : installed === null ? "wait" : "busy";
  const findRow: Row = !status || scanning ? "busy" : "done";
  const indexRow: Row = !status ? "wait" : indexing ? (scanning ? "wait" : "busy") : "done";

  const finish = (then: AfterSetup) => finishOnboarding(then).catch((e) => setError(String(e)));

  return (
    <>
      {ready ? (
        <StepHeader
          title="You're all set"
          lead={`${status.files.toLocaleString()} files are indexed and new ones are added as they appear.`}
        />
      ) : (
        <StepHeader
          title="Warming up"
          lead="The first run downloads the search model and reads your folders, which can take a while. You can close this window. WinFynd carries on in the tray and lets you know when it's done."
        />
      )}

      <section className="ob-card">
        <ul className="ob-list">
          <WarmRow state={modelRow} title="Search model">
            {modelReady
              ? "EmbeddingGemma 2 is ready"
              : installed === null
                ? "Waiting for Ollama. Until it's installed, WinFynd finds files by words and names."
                : downloading
                  ? `Downloading EmbeddingGemma 2 · ${pct(downloading.completed, downloading.total)}%${downloading.total ? ` of ${formatBytes(downloading.total)}` : ""}`
                  : "Starting the download…"}
            {downloading && <Bar value={pct(downloading.completed, downloading.total)} label="Downloading the search model" />}
            {installed === null && (
              <button type="button" className="ob-btn ob-inline" onClick={() => openOllamaDownload().catch((e) => setError(String(e)))}>
                Get Ollama
              </button>
            )}
          </WarmRow>
          <WarmRow state={findRow} title="Finding your files">
            {findRow === "busy"
              ? `Looking through ${config.roots.length === 1 ? "1 folder" : `${config.roots.length} folders`}…`
              : `${total.toLocaleString()} files in ${config.roots.length === 1 ? "1 folder" : `${config.roots.length} folders`}`}
          </WarmRow>
          <WarmRow
            state={indexRow}
            title="Indexing"
            aside={
              indexing && drops.length > 0 ? (
                <div className="ob-drops" aria-hidden="true">
                  {drops.map((d, i) => (
                    <span key={d.id} className="ob-drop" style={{ opacity: 1 - i * 0.3 }}>
                      <span className="ob-drop-kind">{KIND_LABEL[d.kind] ?? "FILE"}</span>
                      <span className="ob-ellipsis">{d.name}</span>
                    </span>
                  ))}
                </div>
              ) : undefined
            }
          >
            {!status
              ? "Starting…"
              : indexing
                ? `${status.files.toLocaleString()} of ${total.toLocaleString()} files · recordings and videos go last`
                : `${status.files.toLocaleString()} files, ${status.chunks.toLocaleString()} passages and images`}
            {status && indexing && !scanning && <Bar value={pct(status.files, total)} label="Indexing" />}
          </WarmRow>
        </ul>

      </section>

      <section className="ob-section">
        <h2>{ready ? "Things to try" : "Try these once it's ready"}</h2>
        <ul className="ob-ideas">
          {IDEAS.map((idea) => (
            <li key={idea} className="ob-idea">
              <Icon name="search" size={14} />
              {idea}
            </li>
          ))}
        </ul>
      </section>

      <p className="ob-muted ob-tray">
        WinFynd lives in the system tray. Press {launcherKey ? <KeyCombo accelerator={launcherKey} /> : "the shortcut"} any time to search.
      </p>

      {error && (
        <p className="ob-error" role="alert">
          {error}
        </p>
      )}

      <StepFooter back={back}>
        {ready ? (
          <button type="button" className="ob-btn" onClick={() => finish("control")}>
            Open Control Center
          </button>
        ) : (
          <button type="button" className="ob-btn" onClick={() => finish("tray")}>
            Close and finish in the background
          </button>
        )}
        <button type="button" className="ob-btn ob-btn-accent" onClick={() => finish("launcher")} autoFocus>
          Start searching
        </button>
      </StepFooter>
    </>
  );
}

function isIndexing(s: EngineStatus | null) {
  return !s || s.state !== "idle" || s.queued > 0;
}

function WarmRow({ state, title, aside, children }: { state: Row; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="ob-row ob-warm-row" data-state={state}>
      <span className="ob-warm-icon" aria-hidden="true">
        {state === "done" ? <Check /> : state === "busy" ? <span className="ob-ring" /> : <span className="ob-wait" />}
      </span>
      <span className="ob-row-text">
        <span className="ob-row-title">{title}</span>
        <span className="ob-muted">{children}</span>
      </span>
      {aside}
    </li>
  );
}

function Bar({ value, label }: { value: number; label: string }) {
  return (
    <span className="ob-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <span className="ob-progress-fill" style={{ width: `${Math.max(value, 2)}%` }} />
    </span>
  );
}
