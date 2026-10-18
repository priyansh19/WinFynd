import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { getConfig, type EngineConfig } from "../lib/engine";
import { DoneStep } from "./steps/Done";
import { FoldersStep } from "./steps/Folders";
import { ModelsStep } from "./steps/Models";
import { ShortcutsStep } from "./steps/Shortcuts";
import { WelcomeStep } from "./steps/Welcome";

const STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "folders", label: "What to search" },
  { id: "models", label: "Search by meaning" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "done", label: "Ready" },
] as const;

/** Every step shares the engine config and moves the flow itself. */
export interface StepProps {
  config: EngineConfig;
  setConfig: (c: EngineConfig) => void;
  next: () => void;
  back?: () => void;
}

export function Onboarding() {
  const [index, setIndex] = useState(0);
  const [config, setConfig] = useState<EngineConfig | null>(null);

  useEffect(() => {
    getConfig().then(setConfig);
  }, []);

  const next = () => setIndex((i) => Math.min(i + 1, STEPS.length - 1));
  const back = () => setIndex((i) => Math.max(i - 1, 0));
  const step = STEPS[index];

  return (
    <div className="ob">
      <aside className="ob-rail">
        <div className="ob-brand">
          <span className="ob-mark" aria-hidden="true">
            <Icon name="search" size={16} />
          </span>
          WinFynd
        </div>
        <ol className="ob-steps" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              className="ob-step"
              data-state={i < index ? "done" : i === index ? "current" : "todo"}
              aria-current={i === index ? "step" : undefined}
            >
              <span className="ob-step-dot" aria-hidden="true">
                {i < index ? <Check /> : i + 1}
              </span>
              {s.label}
            </li>
          ))}
        </ol>
        <p className="ob-rail-foot">
          <Icon name="lock" size={14} />
          Your files, searches and voice stay on this PC.
        </p>
      </aside>

      <main className="ob-main" key={step.id}>
        {config && (
          <>
            {step.id === "welcome" && <WelcomeStep config={config} setConfig={setConfig} next={next} />}
            {step.id === "folders" && <FoldersStep config={config} setConfig={setConfig} next={next} back={back} />}
            {step.id === "models" && <ModelsStep config={config} setConfig={setConfig} next={next} back={back} />}
            {step.id === "shortcuts" && <ShortcutsStep config={config} setConfig={setConfig} next={next} back={back} />}
            {step.id === "done" && <DoneStep config={config} setConfig={setConfig} next={next} back={back} />}
          </>
        )}
      </main>
    </div>
  );
}

export function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** Title and lead line at the top of each step. */
export function StepHeader({ title, lead }: { title: string; lead: string }) {
  return (
    <header className="ob-header">
      <h1>{title}</h1>
      <p>{lead}</p>
    </header>
  );
}

/** Back on the left, the step's actions on the right, like Windows setup. */
export function StepFooter({ back, children }: { back?: () => void; children: React.ReactNode }) {
  return (
    <footer className="ob-footer">
      {back ? (
        <button type="button" className="ob-btn" onClick={back}>
          Back
        </button>
      ) : (
        <span />
      )}
      <div className="ob-footer-actions">{children}</div>
    </footer>
  );
}
