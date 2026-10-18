import { Icon } from "../components/Icon";
import { useShellImage } from "../lib/native";
import { folderOf, formatSize, GROUP_LABEL, mediaUrl, thumbnailUrl, type SearchResult } from "../lib/search";
import { FileIcon } from "../components/FileIcon";

/** The details pane: what the file looks like, why it matched, and its properties. */
export function Preview({ result }: { result: SearchResult }) {
  const photo = thumbnailUrl(result);
  const media = mediaUrl(result);
  // Explorer's own thumbnail covers documents, slides and videos too.
  const explorer = useShellImage(result.path, 240, true);

  return (
    <section className="preview" aria-label="Details">
      <div className="preview-hero">
        {media && result.kind === "video" ? (
          // key: reload when the result changes so playback starts at its moment.
          <video key={media} className="preview-video" src={media} controls preload="metadata" />
        ) : photo ? (
          <img className="preview-image" src={photo} alt="" />
        ) : explorer ? (
          <img className="preview-thumb" src={explorer} alt="" />
        ) : (
          <FileIcon path={result.path} kind={result.kind} size={96} />
        )}
      </div>
      {media && result.kind === "audio" && <audio key={media} className="preview-audio" src={media} controls preload="metadata" />}

      <h2 className="preview-name selectable">{result.name}</h2>
      <div className="preview-reason">
        <Icon name="sparkle" size={16} />
        {result.reason}
      </div>

      {result.snippet && (
        <figure className="preview-snippet">
          {result.location && <figcaption>{result.location}</figcaption>}
          <blockquote className="selectable">{result.snippet}</blockquote>
        </figure>
      )}

      <dl className="preview-props">
        <dt>Type</dt>
        <dd>{GROUP_LABEL[result.kind].replace(/s$/, "")}</dd>
        <dt>Size</dt>
        <dd>{formatSize(result.size)}</dd>
        <dt>Modified</dt>
        <dd>
          {new Date(result.modified * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        </dd>
        <dt>Location</dt>
        <dd className="selectable" title={result.path}>
          {folderOf(result.path)}
        </dd>
      </dl>
    </section>
  );
}

