import type { Answer } from "../lib/search";

export function AnswerPanel({ answer }: { answer: Answer | null }) {
  if (!answer) {
    return <div className="launcher-empty">Ask a question and press Enter. Answers cite the files they came from.</div>;
  }
  return (
    <div className="answer">
      <div className="answer-main">
        <div className="answer-status">
          <span className="dot-ok" aria-hidden="true" />
          Read {answer.sources.length} files on this PC · {answer.model}
        </div>
        {answer.headline && <div className="answer-headline">{answer.headline}</div>}
        <p className="answer-text">{answer.text}</p>
      </div>
      <aside className="answer-sources" aria-label="Sources">
        <div className="result-group-label">Sources</div>
        {answer.sources.map((s) => (
          <div key={s.n} className="answer-source">
            <span className="cite">{s.n}</span>
            <div className="result-text">
              <span className="result-name">{s.name}</span>
              <span className="result-path">{s.detail}</span>
            </div>
          </div>
        ))}
      </aside>
    </div>
  );
}
