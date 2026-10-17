import { Icon } from "../components/Icon";
import { openLabel, type SearchResult } from "../lib/search";

export function Preview({ result }: { result: SearchResult }) {
  const playable = result.kind === "video" || result.kind === "audio";
  return (
    <section className="preview" aria-label="Preview">
      <div className="preview-media" style={{ background: result.tint }}>
        {playable && (
          <button type="button" className="preview-play" aria-label={openLabel(result)}>
            <Icon name="play" size={22} />
          </button>
        )}
        {result.moment && <span className="preview-stamp">{result.moment.label}</span>}
      </div>
      <div className="preview-title">
        <strong>{result.name}</strong>
        <span>{result.path}</span>
        <span>{result.meta}</span>
      </div>
      {result.snippet && <p className="preview-snippet">“{result.snippet}”</p>}
      {result.moment && (
        <div className="preview-reason">
          <Icon name="search" size={16} />
          {result.moment.reason}
        </div>
      )}
      <div className="preview-actions">
        <button type="button" className="glass-btn glass-btn-primary">
          {openLabel(result)}
        </button>
        <button type="button" className="glass-btn">
          Show in Explorer
        </button>
      </div>
    </section>
  );
}
