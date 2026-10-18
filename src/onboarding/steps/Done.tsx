import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { KeyCombo } from "../../components/Keycap";
import { useEngineStatus } from "../../lib/engine";
import { getHotkeys } from "../../lib/hotkeys";
import { finishOnboarding, type AfterSetup } from "../../lib/onboarding";
import { Check, StepFooter, StepHeader, type StepProps } from "../Onboarding";

const IDEAS = [
  "the lease agreement I signed last spring",
  "photo of a birthday cake",
  "slides about the Q3 budget",
  "notes that mention the dentist",
];

export function DoneStep({ config, back }: StepProps) {
  const status = useEngineStatus();
  const [launcherKey, setLauncherKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHotkeys().then((s) => setLauncherKey(s.config.launcher));
  }, []);

  const finish = (then: AfterSetup) => finishOnboarding(then).catch((e) => setError(String(e)));

  const working = status && status.state !== "idle";
  const total = status ? status.files + status.queued : 0;
  const share = status && total > 0 ? Math.round((status.files / total) * 100) : 0;

  return (
    <>
      <StepHeader
        title="You're all set"
        lead={`WinFynd is watching ${config.roots.length === 1 ? "your folder" : `your ${config.roots.length} folders`}. You can search right away; results fill in as files are indexed.`}
      />

      <section className="ob-card ob-row" aria-live="polite">
        <span className="ob-callout-icon" data-done={!working || undefined}>
          {working ? <Icon name="search" size={20} /> : <Check />}
        </span>
        <span className="ob-row-text">
          <span className="ob-row-title">
            {!status ? "Starting…" : working ? "Indexing your files" : "Your files are indexed"}
          </span>
          <span className="ob-muted">
            {status
              ? `${status.files.toLocaleString()} files ready${status.queued > 0 ? ` · ${status.queued.toLocaleString()} to go` : ""}`
              : " "}
            {status && status.ollama !== "ok" && " · Exact words and names only until EmbeddingGemma 2 is downloaded"}
          </span>
          {working && (
            <span className="ob-progress" role="progressbar" aria-label="Indexing" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share}>
              <span className="ob-progress-fill" style={{ width: `${Math.max(share, 2)}%` }} />
            </span>
          )}
        </span>
      </section>

      <section className="ob-section">
        <h2>Things to try</h2>
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
        WinFynd keeps running in the system tray. Press {launcherKey ? <KeyCombo accelerator={launcherKey} /> : "the shortcut"} any time to search.
      </p>

      {error && (
        <p className="ob-error" role="alert">
          {error}
        </p>
      )}

      <StepFooter back={back}>
        <button type="button" className="ob-btn" onClick={() => finish("control")}>
          Open Control Center
        </button>
        <button type="button" className="ob-btn ob-btn-accent" onClick={() => finish("launcher")} autoFocus>
          Start searching
        </button>
      </StepFooter>
    </>
  );
}
