import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppIcon, Icon } from "../components/Icon";
import { Caps } from "../components/TitleBar";
import {
  downloadSpeechModel,
  pullModel,
  useEngineConfig,
  type EngineConfig,
  type PullProgress,
  type SpeechProgress,
} from "../lib/engine";
import { finishOnboarding, markSetupDone, type AfterSetup } from "../lib/onboarding";
import { inTauri, listen } from "../lib/tauri";
import { FoldersStep } from "./steps/Folders";
import { ModelStep } from "./steps/Model";
import { ReadyStep } from "./steps/Ready";
import { ShortcutsStep } from "./steps/Shortcuts";
import { WarmUpStep } from "./steps/WarmUp";
import { WelcomeStep } from "./steps/Welcome";

const STEPS = ["Welcome", "What to search", "Search model", "Shortcuts", "Warm-up"];
/** After the last step: every step shows as done. */
const READY = STEPS.length;

/** Every step shares the engine config and the downloads, and moves the flow itself. */
export interface StepProps {
  config: EngineConfig;
  save: (c: EngineConfig) => Promise<EngineConfig>;
  next: () => void;
  back: () => void;
  finish: (then: AfterSetup) => Promise<void>;
  /** Search model downloads by model, shared so they carry on across steps. */
  pulls: Record<string, PullProgress>;
  startPull: (model: string) => void;
  /** The Whisper download; the speech setting turns on when it finishes. */
  speech: SpeechProgress | null;
  /** Download a Whisper model, or with null, don't turn speech on when one finishes. */
  startSpeech: (id: string | null) => void;
}

export function Onboarding() {
  const [index, setIndex] = useState(0);
  const [config, save] = useEngineConfig();
  const [pulls, setPulls] = useState<Record<string, PullProgress>>({});
  const [speech, setSpeech] = useState<SpeechProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** When reading started, if this run of setup saw it happen; null when the index was already done. */
  const [readFor, setReadFor] = useState<number | null>(null);
  const opened = useRef(Date.now());
  const finished = useRef(false);
  const latest = useRef(config);
  latest.current = config;
  /** The Whisper model setup asked for and still wants. */
  const wantSpeech = useRef<string | null>(null);

  useEffect(() => {
    const subs = [
      listen<PullProgress>("models://pull", (p) => setPulls((all) => ({ ...all, [p.model]: p }))),
      // Only setup's own download, and only while it's still wanted; Settings can download too.
      listen<SpeechProgress>("models://speech", (p) => {
        if (p.id !== wantSpeech.current) return;
        setSpeech(p);
        if (p.error) setError(`Whisper didn't download: ${p.error}`);
        const c = latest.current;
        if (p.done && !p.error && c) save({ ...c, speechModel: p.id }).catch((e) => setError(String(e)));
      }),
      // Shown again ("Run setup again", or after closing it early): time reading
      // from now, and start over if it was finished.
      listen("onboarding://shown", () => {
        opened.current = Date.now();
        setReadFor(null);
        setError(null);
        if (!finished.current) return;
        finished.current = false;
        setIndex(0);
      }),
    ];
    return () => subs.forEach((p) => p.then((off) => off()));
  }, [save]);

  const startPull = useCallback(async (model: string) => {
    setPulls((all) => ({ ...all, [model]: { model, status: "starting", completed: 0, total: 0, done: false, error: null } }));
    try {
      await pullModel(model);
    } catch (e) {
      setPulls((all) => ({ ...all, [model]: { model, status: "failed", completed: 0, total: 0, done: true, error: String(e) } }));
    }
  }, []);

  const startSpeech = useCallback(async (id: string | null) => {
    wantSpeech.current = id;
    if (!id) return;
    setSpeech({ id, completed: 0, total: 0, done: false, error: null });
    try {
      await downloadSpeechModel(id);
    } catch (e) {
      setSpeech(null);
      setError(`Whisper didn't download: ${e}`);
    }
  }, []);

  const finish = useCallback((then: AfterSetup) => {
    finished.current = true;
    markSetupDone();
    return finishOnboarding(then).catch((e) => setError(String(e)));
  }, []);

  // Closing the window once warm-up starts finishes setup, the same as
  // "Close and finish in the background", so it doesn't open again next time.
  useEffect(() => {
    if (!inTauri || index < 4) return;
    const off = getCurrentWindow().onCloseRequested((e) => {
      e.preventDefault();
      finish("tray");
    });
    return () => {
      off.then((f) => f());
    };
  }, [index, finish]);

  const next = () => setIndex((i) => Math.min(i + 1, READY));
  const back = () => setIndex((i) => Math.max(i - 1, 0));

  const props: StepProps | null = config
    ? { config, save, next, back, finish, pulls, startPull, speech, startSpeech }
    : null;

  return (
    <div className="setup">
      <Rail current={index} />
      <div className="setup-side">
        <div className="setup-caps" data-tauri-drag-region>
          <Caps maximizable={false} />
        </div>
        {error && (
          <div className="infobar error setup-error" role="alert">
            <Icon name="error" size={16} />
            <span className="grow selectable">{error}</span>
            <button type="button" className="btn subtle" aria-label="Dismiss" onClick={() => setError(null)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
        {props && (
          <div className="setup-step" key={index}>
            {index === 0 && <WelcomeStep {...props} />}
            {index === 1 && <FoldersStep {...props} />}
            {index === 2 && <ModelStep {...props} />}
            {index === 3 && <ShortcutsStep {...props} />}
            {index === 4 && (
              <WarmUpStep
                {...props}
                onReady={(sawReading) => {
                  setReadFor(sawReading ? Date.now() - opened.current : null);
                  setIndex(READY);
                }}
              />
            )}
            {index === READY && <ReadyStep {...props} readFor={readFor} />}
          </div>
        )}
      </div>
    </div>
  );
}

/** The gradient rail: the WinFynd mark, where you are in setup, and the privacy promise. */
function Rail({ current }: { current: number }) {
  return (
    <aside className="rail" data-tauri-drag-region>
      <div className="rail-brand">
        <AppIcon size={28} inverse />
        WinFynd
      </div>
      <ol className="rail-steps" aria-label="Setup steps">
        {STEPS.map((s, i) => {
          const state = i < current ? "done" : i === current ? "current" : "todo";
          return (
            <li key={s} className={`rail-step ${state}`} aria-current={state === "current" ? "step" : undefined}>
              <span className="rail-dot" aria-hidden="true">
                {state === "done" ? <Icon name="check" size={14} strokeWidth={2.2} /> : i + 1}
              </span>
              {s}
            </li>
          );
        })}
      </ol>
      <p className="rail-foot">
        <Icon name="lock" size={14} />
        Your files, searches and voice stay on this PC.
      </p>
    </aside>
  );
}

/** A step's page: its content, then the 72 px footer with Back and the step's actions. */
export function Page({ children, footer, className }: { children: React.ReactNode; footer: React.ReactNode; className?: string }) {
  return (
    <>
      <main className={`setup-main page-enter${className ? ` ${className}` : ""}`}>{children}</main>
      <footer className="setup-foot">{footer}</footer>
    </>
  );
}

/** "Back … Next", the footer of the middle steps. */
export function NavButtons({ back, next, nextLabel = "Next", disabled }: { back: () => void; next: () => void; nextLabel?: string; disabled?: boolean }) {
  return (
    <>
      <button type="button" className="btn big" onClick={back}>
        Back
      </button>
      <span className="push" />
      <button type="button" className="btn accent big" onClick={next} disabled={disabled}>
        {nextLabel}
      </button>
    </>
  );
}
