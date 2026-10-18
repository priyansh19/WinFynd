import { ProgressRing } from "../components/Progress";
import type { Answer } from "../lib/search";

export function AnswerPanel({
  answer,
  loading,
  onOpen,
}: {
  answer: Answer | null;
  loading: boolean;
  onOpen: (path: string) => void;
}) {
  if (loading) {
    return (
      <div className="launcher-empty" role="status">
        <ProgressRing label="Reading your files" />
        <span>Reading your files…</span>
      </div>
    );
  }
  if (!answer) {
    return (
      <div className="launcher-empty">
        <strong>Ask anything about your files</strong>
        <span>Press Enter to ask. Answers are written on this PC and cite the files they came from.</span>
      </div>
    );
  }
  return (
    <div className="answer">
      <div className="answer-main">
        <span className="answer-meta">
          From {answer.sources.length} {answer.sources.length === 1 ? "passage" : "passages"} on this PC · {answer.model}
        </span>
        <p className="answer-text selectable">{answer.text}</p>
      </div>
      {answer.sources.length > 0 && (
        <aside className="answer-sources" aria-label="Sources">
          <div className="result-group-label">Sources</div>
          {answer.sources.map((s) => (
            <button key={s.n} type="button" className="result-row answer-source" onClick={() => onOpen(s.path)}>
              <span className="cite">{s.n}</span>
              <span className="result-text">
                <span className="result-name">{s.name}</span>
                <span className="result-path">{s.location ?? "Open file"}</span>
              </span>
            </button>
          ))}
        </aside>
      )}
    </div>
  );
}
