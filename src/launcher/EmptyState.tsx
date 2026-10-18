import { Icon } from "../components/Icon";
import type { EngineStatus } from "../lib/engine";
import { invoke } from "../lib/tauri";

export function EmptyState({ status, searched }: { status: EngineStatus | null; searched: boolean }) {
  const openSettings = () => invoke("open_control_center").catch(() => {});
  let line: React.ReactNode = "Type, or hold the voice key and speak. Everything stays on this PC.";
  if (searched) line = "Nothing matched. Try other words or describe what's in the file.";
  if (status && status.ollama !== "ok") {
    line = (
      <>
        {status.message ?? "Search by meaning is off."}{" "}
        <button type="button" className="link-button" onClick={openSettings}>
          Open models
        </button>
      </>
    );
  }
  return (
    <div className="launcher-empty">
      <Icon name="lock" size={18} />
      <span>{line}</span>
      {status && status.state !== "idle" && status.state !== "loading" && (
        <span className="empty-progress">
          Indexing · {status.files.toLocaleString()} files done · {status.queued.toLocaleString()} to go
        </span>
      )}
    </div>
  );
}
