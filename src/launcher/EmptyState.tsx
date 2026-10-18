import { Icon } from "../components/Icon";
import { Bar } from "../components/Progress";
import { isBusy, type EngineStatus } from "../lib/engine";
import { pauseIndexing } from "../lib/stats";
import { invoke } from "../lib/tauri";

export const openSettings = (page?: string) => invoke("open_control_center", { page: page ?? null }).catch(() => {});

const clockTime = (unix: number) => new Date(unix * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * One line under the empty search box, only when there's something to know:
 * the first index is still running, reading is paused, or search by meaning
 * is off.
 */
export function Notes({ status }: { status: EngineStatus | null }) {
  if (!status) return null;
  const total = status.files + status.queued;
  const done = status.files.toLocaleString();
  return (
    <>
      {status.ollama !== "ok" && status.state !== "loading" && (
        <div className="lnote">
          <Icon name="warning" size={16} className="warn" />
          <span className="grow">
            {status.ollama === "offline"
              ? "Search by meaning is off because Ollama isn't running. File names and exact words still work."
              : "The search model isn't on this PC yet. File names and exact words work meanwhile."}
          </span>
          <button type="button" className="link" onClick={() => openSettings("models")}>
            Set up models
          </button>
        </div>
      )}
      {status.state === "paused" ? (
        <div className="lnote">
          <span className="pulse still" />
          <span className="grow">
            Reading is paused{status.pausedUntil ? ` until ${clockTime(status.pausedUntil)}` : ""}. You can search the{" "}
            <span className="num">{done}</span> files read so far.
          </span>
          <button type="button" className="link" onClick={() => pauseIndexing(0).catch(() => {})}>
            Resume now
          </button>
        </div>
      ) : (
        isBusy(status) && (
          <div className="lnote">
            <span className="pulse" />
            <span className="grow">
              {status.queued > 0 ? (
                <>
                  Still reading your files: <span className="num">{done}</span> of <span className="num">{total.toLocaleString()}</span>. You
                  can search now; results fill in as it goes.
                </>
              ) : (
                "Looking through your folders for new files. You can search now; results fill in as it goes."
              )}
            </span>
            <Bar label="Files read" live value={status.queued > 0 ? (status.files / total) * 100 : undefined} />
          </div>
        )
      )}
    </>
  );
}

/** "Documents, Pictures or Desktop", from the folders being searched. */
function folderNames(roots: string[]): string {
  const names = roots.map((r) => r.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || r);
  if (names.length === 0) return "your folders";
  if (names.length > 3) return `your ${names.length} folders`;
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** A search that found nothing: what to try instead. */
export function NothingFound({ roots, onAsk }: { roots: string[]; onAsk: () => void }) {
  return (
    <div className="lempty">
      <h2>No files match yet</h2>
      <p>
        Nothing in {folderNames(roots)} looks like this. Describe what was in it, or ask a question and WinFynd will look at the closest files.
      </p>
      <div className="actions">
        <button type="button" className="btn" onMouseDown={(e) => e.preventDefault()} onClick={onAsk}>
          <Icon name="sparkle" />
          Ask instead
        </button>
        <button type="button" className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => openSettings("folders")}>
          <Icon name="folderAdd" />
          Add a folder to search
        </button>
      </div>
    </div>
  );
}
