import { FileIcon } from "../components/FileIcon";
import { useIndexingFeed } from "../lib/feed";

/**
 * The last few files the indexer picked up, sliding into the status corner
 * of the navigation pane: a quiet sign that new files are being processed.
 */
export function IndexingFeed() {
  const items = useIndexingFeed().slice(0, 3);
  if (!items.length) return null;
  return (
    <ol className="feed" aria-label="Recently indexed files">
      {items.map((item) => (
        <li key={item.key} className={`feed-item ${item.stage ? "is-active" : ""}`} title={item.path}>
          <FileIcon path={item.path} kind={item.kind} size={16} />
          <span className="feed-name">{item.path.split(/[\\/]/).pop()}</span>
          {item.stage && <span className="feed-dot" aria-label={item.stage} />}
        </li>
      ))}
    </ol>
  );
}
