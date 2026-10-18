import { useLayoutEffect, useRef, useState } from "react";
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
  const lead = isTimestamp(r.location) ? `Said at ${r.location}` : (r.location ?? (r.snippet ? "Mentions" : null));
  if (!lead) return { lead: folderOf(r.path), text: null };
  // About 46 characters fit the row at 12px; the lead and its " · " come first.
  return { lead, text: excerpt(r.snippet, words, Math.max(16, LINE_CHARS - lead.length - 3)) };
}

const LINE_CHARS = 46;

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
          {lead && text && (r.kind === "image" || lead === "Mentions" ? " " : " · ")}
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
  // Only when the selection or the results change: the launcher re-renders
  // several times a second while indexing, and the wheel has to win then.
  useLayoutEffect(() => {
    document.getElementById(`result-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [selected, results]);

  // One highlight that slides to the selected row; new results start it afresh, in place.
  const [mark, setMark] = useState<{ gen: number; top: number; left: number; width: number; height: number } | null>(null);
  const shown = useRef(results);
  const gen = useRef(0);
  if (shown.current !== results) {
    shown.current = results;
    gen.current++;
  }
  useLayoutEffect(() => {
    const el = document.getElementById(`result-${selected}`);
    const row = el?.classList.contains("row");
    setMark(el && row ? { gen: gen.current, top: el.offsetTop, left: el.offsetLeft, width: el.offsetWidth, height: el.offsetHeight } : null);
  }, [selected, results]);

  return (
    <div className="llist" id="results" role="listbox" aria-label="Results">
      {mark?.gen === gen.current && (
        <div
          key={mark.gen}
          className="lmark"
          aria-hidden="true"
          style={{ transform: `translateY(${mark.top}px)`, left: mark.left, width: mark.width, height: mark.height }}
        />
      )}
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
