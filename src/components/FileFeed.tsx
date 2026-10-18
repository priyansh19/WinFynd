import type { FeedItem } from "../lib/feed";
import { kindClass } from "../lib/kinds";

/**
 * Files dropping in as the indexer reads them: the newest slides in at the
 * top, older ones fade, and each dot pops to its kind's colour when done.
 */
export function FileFeed({ items, max = 5 }: { items: FeedItem[]; max?: number }) {
  return (
    <ol className="feed" aria-label="Files being read">
      {items.slice(0, max).map((f) => (
        <li key={f.key} className={`feeditem ${kindClass(f.kind)}${f.stage === "reading" || f.stage === "embedding" ? " reading" : ""}`} title={f.path}>
          <span className={`state ${f.stage === "embedding" ? "reading" : f.stage}`} aria-label={f.stage} />
          <span className="ellip">{f.name}</span>
        </li>
      ))}
    </ol>
  );
}
