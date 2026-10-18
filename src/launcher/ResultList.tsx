import { extension, folderOf, groupResults, KIND_TINT, thumbnailUrl, type SearchResult } from "../lib/search";

export function ResultList({
  results,
  selected,
  onSelect,
  onOpen,
}: {
  results: SearchResult[];
  selected: number;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
}) {
  return (
    <div className="result-list" role="listbox" aria-label="Results">
      {groupResults(results).map((g) => (
        <div key={g.key} role="group" aria-label={g.label}>
          <div className="result-group-label">{g.label}</div>
          {g.items.map((r) => {
            const index = results.indexOf(r);
            const thumb = thumbnailUrl(r);
            return (
              <div
                key={r.id}
                role="option"
                aria-selected={index === selected}
                className="result-row"
                ref={(el) => {
                  if (index === selected) el?.scrollIntoView({ block: "nearest" });
                }}
                onMouseMove={() => index !== selected && onSelect(index)}
                onClick={() => onSelect(index)}
                onDoubleClick={() => onOpen(index)}
              >
                {thumb ? (
                  <img className="result-thumb" src={thumb} alt="" loading="lazy" />
                ) : (
                  <div className="result-thumb result-thumb-ext" style={{ color: KIND_TINT[r.kind] }}>
                    {extension(r.name)}
                  </div>
                )}
                <div className="result-text">
                  <div className="result-name">
                    <span>{r.name}</span>
                    {r.location && <span className="moment-chip">{r.location}</span>}
                  </div>
                  <span className="result-path">{folderOf(r.path)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
