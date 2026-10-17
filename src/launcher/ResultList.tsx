import { GROUP_LABEL, groupResults, type SearchResult } from "../lib/search";

export function ResultList({
  results,
  selected,
  onSelect,
}: {
  results: SearchResult[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="result-list" role="listbox" aria-label="Results">
      {groupResults(results).map((g) => (
        <div key={g.kind} role="group" aria-label={GROUP_LABEL[g.kind]}>
          <div className="result-group-label">{GROUP_LABEL[g.kind]}</div>
          {g.items.map((r) => {
            const index = results.indexOf(r);
            return (
              <div
                key={r.id}
                role="option"
                aria-selected={index === selected}
                className="result-row"
                onMouseEnter={() => onSelect(index)}
                onClick={() => onSelect(index)}
              >
                <div className="result-thumb" style={{ background: r.tint }} />
                <div className="result-text">
                  <div className="result-name">
                    <span>{r.name}</span>
                    {r.moment && <span className="moment-chip">{r.moment.label}</span>}
                  </div>
                  <span className="result-path">{r.path}</span>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
