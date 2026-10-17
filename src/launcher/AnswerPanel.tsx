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
        <span className="dot-ok pulse" aria-hidden="true" />
        Reading your files…
      </div>
    );
  }
  if (!answer) {
    return <div className="launcher-empty">Ask a question and press Enter. Answers cite the files they came from.</div>;
  }
  return (
    <div className="answer">
      <div className="answer-main">
        <div className="answer-status">
          <span className="dot-ok" aria-hidden="true" />
          Read {answer.sources.length} passages on this PC · {answer.model}
        </div>
        <p className="answer-text">{answer.text}</p>
      </div>
      {answer.sources.length > 0 && (
        <aside className="answer-sources" aria-label="Sources">
          <div className="result-group-label">Sources</div>
          {answer.sources.map((s) => (
            <button key={s.n} type="button" className="answer-source" onClick={() => onOpen(s.path)}>
              <span className="cite">{s.n}</span>
              <div className="result-text">
                <span className="result-name">
                  <span>{s.name}</span>
                </span>
                <span className="result-path">{s.location ?? "Open file"}</span>
              </div>
            </button>
          ))}
        </aside>
      )}
    </div>
  );
}
