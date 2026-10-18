import { Icon } from "../../components/Icon";
import { StepFooter, type StepProps } from "../Onboarding";

const PROMISES = [
  {
    icon: "lock" as const,
    title: "Private by design",
    text: "Every model runs on this PC. Your files, searches and voice never leave it.",
  },
  {
    icon: "sparkle" as const,
    title: "Search by meaning",
    text: "Describe what you remember. “Receipt for the blue sofa” finds the PDF and the photo you took of it.",
  },
  {
    icon: "folder" as const,
    title: "Always up to date",
    text: "New and changed files are indexed as they appear. Press one shortcut from any app to search.",
  },
];

export function WelcomeStep({ next }: StepProps) {
  return (
    <>
      <div className="ob-hero">
        <span className="ob-hero-mark" aria-hidden="true">
          <Icon name="search" size={36} />
        </span>
        <h1>Find anything on your PC</h1>
        <p>WinFynd reads your documents, photos and recordings as they appear, so you can find them later by describing what you remember.</p>
      </div>
      <ul className="ob-promises">
        {PROMISES.map((p) => (
          <li key={p.title} className="ob-card ob-promise">
            <span className="ob-promise-icon">
              <Icon name={p.icon} size={20} />
            </span>
            <span className="ob-promise-title">{p.title}</span>
            <span className="ob-muted">{p.text}</span>
          </li>
        ))}
      </ul>
      <p className="ob-muted ob-center">Setup takes about two minutes. You can change everything later in the Control Center.</p>
      <StepFooter>
        <button type="button" className="ob-btn ob-btn-accent" onClick={next} autoFocus>
          Get started
        </button>
      </StepFooter>
    </>
  );
}
