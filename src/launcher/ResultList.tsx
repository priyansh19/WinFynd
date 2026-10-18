import { folderOf, groupResults, type SearchResult } from "../lib/search";
import { FileIcon } from "../components/FileIcon";

export function ResultList({
  results,
  selected,
  onSelect,
  onOpen,
  onContextMenu,
}: {
  results: SearchResult[];
  selected: number;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
  onContextMenu: (index: number, x: number, y: number) => void;
}) {
  return (
    <div className="result-list" id="results" role="listbox" aria-label="Results">
      {groupResults(results).map((g) => (
        <div key={g.key} role="group" aria-labelledby={`group-${g.key}`}>
          <div className="result-group-label" id={`group-${g.key}`}>
            {g.label}
          </div>
          {g.items.map((r) => {
            const index = results.indexOf(r);
            return (
              <div
                key={r.id}
                id={`result-${index}`}
                role="option"
                aria-selected={index === selected}
                className="result-row"
                ref={(el) => {
                  if (index === selected) el?.scrollIntoView({ block: "nearest" });
                }}
                onMouseDown={(e) => e.preventDefault() /* keep focus in the search box */}
                onClick={() => onSelect(index)}
                onDoubleClick={() => onOpen(index)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onContextMenu(index, e.clientX, e.clientY);
                }}
              >
                <FileIcon path={r.path} kind={r.kind} size={32} />
                <div className="result-text">
                  <span className="result-name" title={r.name}>
                    {r.name}
                  </span>
                  <span className="result-path" title={r.path}>
                    {folderOf(r.path)}
                  </span>
                </div>
                {r.location && <span className="result-location">{r.location}</span>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
