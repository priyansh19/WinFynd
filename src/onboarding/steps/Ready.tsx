import { Icon } from "../../components/Icon";
import { useEngineStatus } from "../../lib/engine";
import { KINDS } from "../../lib/kinds";
import { tryLauncher } from "../../lib/onboarding";
import { useIndexStats } from "../../lib/stats";
import { Page, type StepProps } from "../Onboarding";

/** Eight dots thrown out from the check, one per kind colour. */
const BURST: [number, string][] = [
  [0, "k-doc"], [45, "k-img"], [90, "k-audio"], [135, "k-sheet"], [180, "k-slide"], [225, "k-video"], [270, "k-code"], [315, "k-amber"],
];

const TRY: { text: string; ask?: boolean }[] = [
  { text: "the lease I signed last spring" },
  { text: "photo of a birthday cake" },
  { text: "when is my dentist appointment?", ask: true },
];

/** "47 minutes", "under a minute", "1 hour 12 minutes". */
function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h === 1 ? "1 hour" : `${h} hours`}${m ? ` ${m === 1 ? "1 minute" : `${m} minutes`}` : ""}`;
}

export function ReadyStep({ finish, readFor }: StepProps & { readFor: number | null }) {
  const status = useEngineStatus();
  const stats = useIndexStats(false);
  const count = status ? status.files.toLocaleString() : "";
  const tiles = stats ? KINDS.filter((k) => stats.kinds[k.kind]) : [];

  // Setup closes first, so the launcher opens over whatever was behind it.
  const search = (text: string, ask?: boolean) => finish("tray").then(() => tryLauncher(text, ask).catch(() => {}));

  return (
    <Page
      footer={
        <>
          <span className="push" />
          <button type="button" className="btn big" onClick={() => finish("control")}>
            Open Settings
          </button>
          <button type="button" className="btn accent big" onClick={() => finish("launcher")} autoFocus>
            Start searching
          </button>
        </>
      }
    >
      <div className="ready-head">
        <div className="ready-ring" aria-hidden="true">
          <div className="ring" />
          <div className="ready-check">
            <Icon name="check" size={28} strokeWidth={2.4} />
          </div>
          <div className="burst">
            {BURST.map(([a, k], i) => (
              <i key={a} className={k} style={{ ["--a" as string]: `${a}deg`, ["--d" as string]: `${62 + Math.floor((a % 90) / 6)}px`, animationDelay: `${150 + i * 30}ms` }} />
            ))}
          </div>
        </div>
        <div className="ready-text">
          <h1>You're all set</h1>
          <span className="muted num">
            {readFor !== null ? `${count} files read in ${duration(readFor)}.` : `${count} files are ready to search.`} New files are added as they appear.
          </span>
        </div>
      </div>

      {tiles.length > 0 && (
        <div className="tally">
          {tiles.map((k, i) => (
            <div key={k.kind} className={`tally-tile ${k.cls}`} style={{ animationDelay: `${200 + i * 60}ms` }}>
              <span className="tally-n">
                <span className="dot" />
                <span className="num">{stats!.kinds[k.kind]!.toLocaleString()}</span>
              </span>
              <span className="small muted">{k.label}</span>
            </div>
          ))}
        </div>
      )}

      <div className="try-these">
        <span className="small faint">Try one of these</span>
        <div className="try-these-row">
          {TRY.map((t) => (
            <button key={t.text} type="button" className="btn" onClick={() => search(t.text, t.ask)}>
              <Icon name={t.ask ? "sparkle" : "search"} size={14} />
              {t.text}
            </button>
          ))}
        </div>
      </div>
    </Page>
  );
}
