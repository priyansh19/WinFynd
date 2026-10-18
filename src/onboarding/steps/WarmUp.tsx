import { useEffect, useRef, useState } from "react";
import { FileFeed } from "../../components/FileFeed";
import { Icon } from "../../components/Icon";
import { Bar } from "../../components/Progress";
import { formatBytes, isBusy, listModels, useEngineStatus, useTimeLeft, type InstalledModel } from "../../lib/engine";
import { useIndexingFeed } from "../../lib/feed";
import { KINDS, timeLeft } from "../../lib/kinds";
import { openOllamaDownload, watchFirstIndex } from "../../lib/onboarding";
import { driveList, useDrives, useIndexStats } from "../../lib/stats";
import { Page, type StepProps } from "../Onboarding";

type Mark = "done" | "live" | "wait";

const has = (installed: InstalledModel[], name: string) => installed.find((m) => m.name === name || m.name === `${name}:latest`);
const pct = (done: number, total: number) => (total > 0 ? (done / total) * 100 : 0);
const folders = (n: number) => (n === 1 ? "1 folder" : `${n} folders`);

/**
 * The first download and read can take a while, so this shows what's left,
 * the files dropping in, and lets the user close the window while it finishes.
 */
export function WarmUpStep({ config, pulls, startPull, finish, onReady }: StepProps & { onReady: (sawReading: boolean) => void }) {
  const pull = pulls[config.embedModel];
  const status = useEngineStatus();
  const left = useTimeLeft(status);
  const { items } = useIndexingFeed();
  const stats = useIndexStats(true);
  const drives = useDrives();
  const [installed, setInstalled] = useState<InstalledModel[] | null | undefined>(undefined);
  const started = useRef(false);
  const sawReading = useRef(false);

  // The notification goes out when the first index is done, whether or not this window is still open.
  useEffect(() => {
    watchFirstIndex().catch(() => {});
  }, []);

  // Check the model now and whenever a download finishes; keep looking while Ollama is missing.
  const missing = installed === null;
  useEffect(() => {
    const check = () =>
      listModels()
        .then((m) => setInstalled(m.installed))
        .catch(() => setInstalled(null));
    check();
    if (!missing) return;
    const t = window.setInterval(check, 3000);
    return () => window.clearInterval(t);
  }, [pull?.done, missing]);

  const model = installed ? has(installed, config.embedModel) : undefined;
  const downloading = pull && !pull.done ? pull : null;
  const failed = pull?.done && pull.error ? pull.error : null;

  // The search model is part of warming up: start it if it isn't on this PC
  // yet and no download of it has started (say Ollama arrived late). One that
  // just finished counts, while the list of models catches up.
  useEffect(() => {
    if (started.current || !installed || model || pull) return;
    started.current = true;
    startPull(config.embedModel);
  }, [installed, model, pull, config.embedModel, startPull]);

  const busy = !status || isBusy(status) || status.state === "loading";
  if (status && isBusy(status)) sawReading.current = true;
  const complete = !!status && !busy && !!model;

  // Wait a moment before moving on, so a status from before the folders changed can't skip ahead.
  const ready = useRef(onReady);
  ready.current = onReady;
  useEffect(() => {
    if (!complete) return;
    const t = window.setTimeout(() => ready.current(sawReading.current), 1500);
    return () => window.clearTimeout(t);
  }, [complete]);

  // This pass: files read so far out of all it has to read.
  const total = status ? status.done + status.queued : 0;
  const scanning = !status || status.state === "scanning" || status.state === "loading";
  const modelMark: Mark = model ? "done" : installed === null || failed ? "wait" : "live";
  const findMark: Mark = scanning ? "live" : "done";
  const readMark: Mark = !status ? "wait" : busy ? "live" : "done";
  const kinds = stats ? KINDS.filter((k) => stats.kinds[k.kind]) : [];
  // "on C: and D:" with full OS context, otherwise "in 3 folders".
  const searched = drives?.filter((d) => !config.skip.includes(d.path)) ?? [];
  const where = config.wholePc ? (searched.length ? `on ${driveList(searched)}` : "on this PC") : `in ${folders(config.roots.length)}`;

  return (
    <Page
      footer={
        <>
          <button type="button" className="btn big subtle close-later" onClick={() => finish("tray")}>
            Close and finish in the background
          </button>
          <span className="push" />
          <button type="button" className="btn accent big" onClick={() => finish("launcher")} autoFocus>
            Start searching
          </button>
        </>
      }
    >
      <h1 className="setup-title warm-title">Warming up</h1>
      <p className="setup-lede" style={{ maxWidth: 600 }}>
        You can close this window. WinFynd keeps reading in the background and lets you know when everything is searchable.
      </p>

      <div className="warm">
        <div className="panel warm-steps">
          <Row
            mark={modelMark}
            title="Search model"
            sub={
              model
                ? `EmbeddingGemma 2 downloaded · ${formatBytes(model.size)}`
                : installed === null
                  ? "Waiting for Ollama. Until it runs, WinFynd finds files by words and names."
                  : failed
                    ? `The download stopped: ${failed}`
                    : downloading && downloading.total
                      ? `Downloading EmbeddingGemma 2 · ${Math.round(pct(downloading.completed, downloading.total))}% of ${formatBytes(downloading.total)}`
                      : "Starting the download…"
            }
          >
            {downloading && <Bar label="Downloading the search model" live value={pct(downloading.completed, downloading.total)} />}
            {installed === null && (
              <button type="button" className="btn" onClick={() => openOllamaDownload().catch(() => {})}>
                Get Ollama
              </button>
            )}
            {failed && (
              <button type="button" className="btn" onClick={() => startPull(config.embedModel)}>
                Try again
              </button>
            )}
          </Row>
          <Row
            mark={findMark}
            title="Finding your files"
            sub={scanning ? `Looking for files ${where}…` : `${(busy ? Math.max(total, status!.files) : status!.files).toLocaleString()} files ${where}`}
          />
          <Row
            mark={readMark}
            title="Reading your files"
            sub={
              !status
                ? "Starting…"
                : busy
                  ? `${status.done.toLocaleString()} of ${total.toLocaleString()}${status.state === "paused" ? " · paused" : timeLeft(left) ? ` · ${timeLeft(left)}` : ""}`
                  : `${status.files.toLocaleString()} files read`
            }
          >
            {status && busy && !scanning && <Bar label="Files read" live={status.state !== "paused"} value={pct(status.done, total)} />}
          </Row>
          <p className="warm-note small faint">
            {model
              ? "Search works now. Recordings and videos are read last because they take longest."
              : "Search works now by words and names. Searching by meaning starts when the model is ready."}
          </p>
        </div>
        <section className="panel warm-feed" aria-label="Reading now">
          <span className="small faint warm-feed-head">
            <span className={`pulse${busy ? "" : " still"}`} />
            Reading now
          </span>
          {items.length > 0 ? <FileFeed items={items} /> : <span className="small faint">{busy ? "Looking for files…" : "Nothing left to read."}</span>}
        </section>
      </div>

      {kinds.length > 0 && (
        <div className="read-so-far">
          <span className="small faint">Read so far</span>
          <div className="read-chips">
            {kinds.map((k) => (
              <span key={k.kind} className={`chip ${k.cls}`}>
                <span className="num">{stats!.kinds[k.kind]!.toLocaleString()}</span> {k.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </Page>
  );
}

function Row({ mark, title, sub, children }: { mark: Mark; title: string; sub: string; children?: React.ReactNode }) {
  return (
    <div className="warm-row">
      {mark === "done" ? (
        <span className="warm-mark done" aria-label="Done">
          <Icon name="check" size={14} strokeWidth={2.4} />
        </span>
      ) : mark === "live" ? (
        <span className="ring live warm-mark" aria-label="In progress" />
      ) : (
        <span className="warm-mark wait k-amber" aria-label="Waiting">
          <Icon name="warning" size={16} />
        </span>
      )}
      <div className="warm-text">
        <span>{title}</span>
        <span className="small muted num">{sub}</span>
        {children}
      </div>
    </div>
  );
}
