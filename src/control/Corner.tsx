import { FileFeed } from "../components/FileFeed";
import { Bar } from "../components/Progress";
import { isBusy, type EngineStatus } from "../lib/engine";
import { useIndexingFeed } from "../lib/feed";
import { pauseIndexing } from "../lib/stats";

/**
 * The live corner at the foot of the navigation: files dropping in as the
 * indexer reads them, each popping to its colour when done. The only motion
 * in Settings, kept to this corner so it's noticed without being watched.
 */
export function Corner({ status }: { status: EngineStatus | null }) {
  const { items } = useIndexingFeed();
  if (!status) return null;
  const busy = isBusy(status);
  const paused = status.state === "paused";
  const total = status.files + status.queued;

  return (
    <section className="panel corner" aria-label="Indexing">
      <div className="corner-head">
        <span className={`pulse${busy && !paused ? "" : " still"}`} style={busy ? undefined : { ["--k" as string]: "var(--ok)" }} />
        <strong>{paused ? "Paused" : busy ? "Indexing" : "Up to date"}</strong>
        {paused ? (
          <button type="button" className="link small" onClick={() => pauseIndexing(0).catch(() => {})}>
            Resume
          </button>
        ) : (
          busy && <span className="small faint num">{status.queued.toLocaleString()} in queue</span>
        )}
      </div>
      {items.length > 0 ? (
        <FileFeed items={items} />
      ) : (
        <p className="small faint corner-quiet">{busy ? "Looking through your folders…" : "New and changed files are read within seconds of being saved."}</p>
      )}
      <Bar label="Files read" live={busy && !paused} value={total ? (status.files / total) * 100 : 100} />
      <span className="small faint num">
        {busy ? `${status.files.toLocaleString()} of ${total.toLocaleString()} files read` : `${status.files.toLocaleString()} files ready to search`}
      </span>
    </section>
  );
}
