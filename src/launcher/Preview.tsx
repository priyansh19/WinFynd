import { Icon } from "../components/Icon";
import { describe, extension, folderOf, KIND_TINT, mediaUrl, thumbnailUrl, type SearchResult } from "../lib/search";

export function Preview({ result, onOpen, onReveal }: { result: SearchResult; onOpen: () => void; onReveal: () => void }) {
  const thumb = thumbnailUrl(result);
  const media = mediaUrl(result);
  return (
    <section className="preview" aria-label="Preview">
      {media && result.kind === "video" ? (
        <div className="preview-media">
          {/* key: reload when the result changes so playback starts at its moment. */}
          <video key={media} className="preview-video" src={media} controls preload="metadata" />
          {result.location && <span className="preview-stamp">{result.location}</span>}
        </div>
      ) : thumb ? (
        <img className="preview-media preview-image" src={thumb} alt={result.name} />
      ) : result.snippet ? (
        <div className="preview-media preview-text">
          {result.location && <span className="preview-stamp">{result.location}</span>}
          <p>{result.snippet}</p>
        </div>
      ) : (
        <div className="preview-media preview-icon" style={{ color: KIND_TINT[result.kind] }}>
          {extension(result.name)}
        </div>
      )}
      {media && result.kind === "audio" && <audio key={media} className="preview-audio" src={media} controls preload="metadata" />}
      <div className="preview-title">
        <strong>{result.name}</strong>
        <span>{folderOf(result.path)}</span>
        <span>{describe(result)}</span>
      </div>
      <div className="preview-reason">
        <Icon name="search" size={16} />
        {result.reason}
      </div>
      <div className="preview-actions">
        <button type="button" className="glass-btn glass-btn-primary" onClick={onOpen}>
          {result.location ? `Open (${result.location})` : "Open"}
        </button>
        <button type="button" className="glass-btn" onClick={onReveal}>
          Show in folder
        </button>
      </div>
    </section>
  );
}
