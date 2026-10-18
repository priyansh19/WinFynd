import { Fragment } from "react";
import { FileGlyph } from "../components/FileIcon";
import { Icon } from "../components/Icon";
import { Keys } from "../components/Keycap";
import { kindClass, kindOfPath } from "../lib/kinds";
import { folderOf, type Answer } from "../lib/search";

/** "llama3.2:3b" reads as "llama3.2 3B". */
export function modelLabel(model: string): string {
  return model
    .replace(/:latest$/, "")
    .replace(/:(\d+(?:\.\d+)?)b$/i, " $1B")
    .replace(":", " ");
}

/** The answer as plain text with its sources listed, for the clipboard. */
export function answerAsText(answer: Answer): string {
  const sources = answer.sources.map((s) => `[${s.n}] ${s.name}${s.location ? `, ${s.location}` : ""}`);
  return `${answer.text.replace(/\*\*(.+?)\*\*/g, "$1")}\n\nSources\n${sources.join("\n")}`;
}

/** One paragraph: **bold** for the facts, [n] for where each came from. */
function Paragraph({ text, answer, onOpen }: { text: string; answer: Answer; onOpen: (path: string) => void }) {
  const parts = text.split(/(\*\*.+?\*\*|\[\d+\])/g).filter(Boolean);
  return (
    <p>
      {parts.map((part, i) => {
        const cite = part.match(/^\[(\d+)\]$/);
        if (cite) {
          const source = answer.sources.find((s) => s.n === Number(cite[1]));
          if (!source) return <Fragment key={i}>{part}</Fragment>;
          return (
            <button
              key={i}
              type="button"
              className={`tag cite ${kindClass(kindOfPath(source.path))}`}
              title={`Open ${source.name}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onOpen(source.path)}
            >
              {source.n}
            </button>
          );
        }
        const bold = part.match(/^\*\*(.+)\*\*$/);
        return bold ? <strong key={i}>{bold[1]}</strong> : <Fragment key={i}>{part}</Fragment>;
      })}
    </p>
  );
}

/**
 * Ask: before a question, a line on what it does; while it thinks, the
 * search line runs; then the answer with numbered sources from this PC.
 */
export function AnswerPanel({
  answer,
  loading,
  seconds,
  onOpen,
}: {
  answer: Answer | null;
  loading: boolean;
  seconds: number | null;
  onOpen: (path: string) => void;
}) {
  if (loading) {
    return (
      <div className="thinking" role="status">
        <span className="pulse" />
        Reading the closest passages in your files
      </div>
    );
  }
  if (!answer) {
    return (
      <div className="ask-hint">
        <span>Ask about anything in your files. The answer is written on this PC and says which file each part came from.</span>
        <span className="faint">
          Press <Keys keys={["Enter"]} /> to ask
        </span>
      </div>
    );
  }
  const files = new Set(answer.sources.map((s) => s.path)).size;
  return (
    <div className="answer">
      <div className="answer-text selectable">
        {answer.text
          .split(/\n\s*\n/)
          .filter((p) => p.trim())
          .map((p, i) => (
            <Paragraph key={i} text={p.trim()} answer={answer} onOpen={onOpen} />
          ))}
      </div>
      {answer.sources.length > 0 && (
        <div className="sources">
          <span className="small faint">Sources</span>
          <div className="stack">
            {answer.sources.map((s) => {
              const kind = kindOfPath(s.path);
              return (
                <button key={s.n} type="button" className={`card tight source ${kindClass(kind)}`} onClick={() => onOpen(s.path)}>
                  <span className="tag">{s.n}</span>
                  <FileGlyph path={s.path} kind={kind} size={28} />
                  <span className="grow">
                    <span className="t ellip">{s.name}</span>
                    <span className="s ellip">{s.location ?? folderOf(s.path)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="answer-foot small faint">
        <Icon name="lock" size={14} />
        Answered on this PC by {modelLabel(answer.model)}
        {seconds !== null && ` in ${seconds.toFixed(1)} s`}
        {files > 0 && `, from ${files} of your ${files === 1 ? "file" : "files"}`}.
      </div>
    </div>
  );
}
