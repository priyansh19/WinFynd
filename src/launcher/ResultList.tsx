import { FileIcon } from "../components/FileIcon";
import { kindClass } from "../lib/kinds";
import { excerpt, isTimestamp, queryWords, reasonOf } from "../lib/match";
import { folderOf, groupResults, thumbnailUrl, PHOTO_GRID_MIN, type SearchResult } from "../lib/search";
import { useShellImage } from "../lib/native";

/** The grey-then-brighter second line under a result: where it matched, then the words there. */
function metaLine(r: SearchResult, query: string): { lead: string | null; text: string | null } {
  const words = queryWords(query);
  const reason = reasonOf(r, query);
  if (reason.kind === "looks") {
    return { lead: r.kind === "image" ? "Looks like" : `Shown at ${r.location ?? ""}`.trim(), text: words.join(", ") || null };
  }
  const line = excerpt(r.snippet, words);
  if (isTimestamp(r.location)) return { lead: `Said at ${r.location}`, text: line };
  if (r.location) return { lead: r.location, text: line };
  if (line) return { lead: null, text: line };
  return { lead: folderOf(r.path), text: null };
}

function Row({
  r,
  index,
  selected,
  query,
  onSelect,
  onOpen,
  onContextMenu,
}: {
  r: SearchResult;
  index: number;
  selected: boolean;
  query: string;
  onSelect: (i: number) => void;
  onOpen: (i: number) => void;
  onContextMenu: (i: number, x: number, y: number) => void;
}) {
  const { lead, text } = metaLine(r, query);
  return (
    <div
      id={`result-${index}`}
      role="option"
      aria-selected={selected}
      className={`row ${kindClass(r.kind)}${selected ? " on" : ""}`}
      ref={(el) => {
        if (selected) el?.scrollIntoView({ block: "nearest" });
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
      <div className="txt">
        <span className="n ellip" title={r.name}>
          {r.name}
        </span>
        <span className="m ellip" title={r.path}>
          {lead}
          {lead && text && (r.kind === "image" ? " " : " · ")}
          {text && <em>{text}</em>}
        </span>
      </div>
    </div>
  );
}

function Photo({ r, index, selected, onSelect, onOpen }: { r: SearchResult; index: number; selected: boolean; onSelect: (i: number) => void; onOpen: (i: number) => void }) {
  const direct = thumbnailUrl(r);
  const shell = useShellImage(r.path, 120, true);
  const src = direct ?? shell;
  return (
    <div
      id={`result-${index}`}
      role="option"
      aria-selected={selected}
      aria-label={r.name}
      title={r.name}
      className={`photo${selected ? " on" : ""}`}
      ref={(el) => {
        if (selected) el?.scrollIntoView({ block: "nearest" });
      }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onSelect(index)}
      onDoubleClick={() => onOpen(index)}
    >
      {src && <img src={src} alt="" loading="lazy" />}
    </div>
  );
}

export function ResultList({
  results,
  selected,
  query,
  onSelect,
  onOpen,
  onContextMenu,
}: {
  results: SearchResult[];
  selected: number;
  query: string;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
  onContextMenu: (index: number, x: number, y: number) => void;
}) {
  return (
    <div className="llist" id="results" role="listbox" aria-label="Results">
      {groupResults(results).map((g) => {
        const grid = g.key === "image" && g.items.length >= PHOTO_GRID_MIN;
        return (
          <div key={g.key} role="group" aria-labelledby={`group-${g.key}`}>
            <div className="lgroup" id={`group-${g.key}`}>
              <span>{g.label}</span>
              {g.items.length > 1 && <span className="count num">{g.items.length}</span>}
            </div>
            {grid ? (
              <div className="photogrid">
                {g.items.map((r) => {
                  const index = results.indexOf(r);
                  return <Photo key={r.id} r={r} index={index} selected={index === selected} onSelect={onSelect} onOpen={onOpen} />;
                })}
              </div>
            ) : (
              g.items.map((r) => {
                const index = results.indexOf(r);
                return (
                  <Row
                    key={r.id}
                    r={r}
                    index={index}
                    selected={index === selected}
                    query={query}
                    onSelect={onSelect}
                    onOpen={onOpen}
                    onContextMenu={onContextMenu}
                  />
                );
              })
            )}
          </div>
        );
      })}
    </div>
  );
}
