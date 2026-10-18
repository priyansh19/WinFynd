import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/Progress";
import type { EngineStatus } from "../lib/engine";
import { invoke } from "../lib/tauri";

/**
 * Under an empty search box: a one-line status, only when there's something
 * to know (indexing, or search by meaning is off). After a search that found
 * nothing: what to try instead.
 */
export function EmptyState({ status, searched }: { status: EngineStatus | null; searched: boolean }) {
  const openSettings = () => invoke("open_control_center").catch(() => {});

  if (searched) {
    return (
      <div className="launcher-empty">
        <Icon name="search" size={32} />
        <strong>No matching files</strong>
        <span>Try other words, or describe what's in the file or photo.</span>
      </div>
    );
  }

  const offline = status && status.ollama !== "ok";
  return (
    <>
      {offline && (
        <div className="launcher-status">
          <Icon name="warning" size={16} className="launcher-status-warning" />
          <span>{status.message ?? "Search by meaning is off."} Exact words and file names still work.</span>
          <button type="button" className="hyperlink" onClick={openSettings}>
            Set up models
          </button>
        </div>
      )}
      {status && status.state !== "idle" && (
        <div className="launcher-status">
          <span>
            Indexing · {status.files.toLocaleString()} files done · {status.queued.toLocaleString()} to go
          </span>
          <ProgressBar label="Indexing" value={status.files + status.queued ? (status.files / (status.files + status.queued)) * 100 : undefined} />
        </div>
      )}
    </>
  );
}
