import { useEffect, useMemo, useRef, useState } from "react";
import { FileGlyph } from "../components/FileIcon";
import { Icon } from "../components/Icon";
import { kindClass } from "../lib/kinds";
import { highlight, isTimestamp, queryWords, reasonOf, type Reason } from "../lib/match";
import { useShellImage } from "../lib/native";
import { folderOf, formatSize, mediaUrl, secondsOf, thumbnailUrl, type SearchResult } from "../lib/search";

/** Lets the launcher's Enter key start playback of the selected recording. */
export interface PreviewControls {
  play?: () => void;
}

/** "14 March 2026, 18:22", in the PC's own date and time style. */
const when = (unix: number) => {
  const d = new Date(unix * 1000);
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
};

/** "small" → "Whisper Small", "large-v3-turbo" → "Whisper Large v3 Turbo". */
const whisper = (id: string) =>
  `Whisper ${id
    .split("-")
    .map((w) => (/^v\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")}`;

const clock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

function Marked({ text, words }: { text: string; words: string[] }) {
  return (
    <>
      {highlight(text, words).map((run, i) => (run.hit ? <mark key={i}>{run.text}</mark> : <span key={i}>{run.text}</span>))}
    </>
  );
}

function Chips({ reason, kind }: { reason: Reason; kind: string }) {
  const cls = kindClass(kind);
  return (
    <div className="chips">
      {reason.kind === "words" && <span className="chip">Words: {reason.words.join(", ")}</span>}
      {reason.kind === "words" && reason.meaning && (
        <span className="chip">
          <Icon name="sparkle" size={12} /> Similar meaning
        </span>
      )}
      {reason.kind === "looks" && reason.words.length > 0 && (
        <span className={`chip ${cls}`}>
          <Icon name="sparkle" size={12} /> Looks like: {reason.words.join(", ")}
        </span>
      )}
      {reason.kind === "meaning" && (
        <span className="chip">
          <Icon name="sparkle" size={12} /> Matches the meaning
        </span>
      )}
      {reason.kind === "name" && <span className="chip k-other">Name matches</span>}
    </div>
  );
}

/** The matching passage on a page, its words highlighted; Explorer's thumbnail when there's no text. */
function Page({ r, words }: { r: SearchResult; words: string[] }) {
  const thumb = useShellImage(r.path, 480, true);
  if (r.snippet) {
    const stem = r.name.replace(/\.[^.]+$/, "");
    return (
      <div className="paper">
        <div className="paper-head">
          <b>{stem}</b>
          {r.location && <span>{r.location}</span>}
        </div>
        <div className={`paper-body selectable${r.kind === "code" ? " code" : ""}`}>
          <Marked text={r.snippet.replace(/^…\s*/, "").replace(/\s*…$/, "")} words={words} />
        </div>
      </div>
    );
  }
  if (thumb) {
    return (
      <div className="paper thumb">
        <img src={thumb} alt="" />
      </div>
    );
  }
  return (
    <div className="paper blank">
      <FileGlyph path={r.path} kind={r.kind} size={88} />
    </div>
  );
}

/** Bars for a recording's waveform, the same for the same file every time. */
function useBars(path: string, n = 96): number[] {
  return useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < path.length; i++) h = Math.imul(h ^ path.charCodeAt(i), 16777619);
    return Array.from({ length: n }, (_, i) => {
      h = Math.imul(h ^ (h >>> 13), 2246822507) >>> 0;
      const swell = 0.55 + 0.45 * Math.sin(i / 7 + (h % 7));
      return Math.max(0.25, Math.min(1, 0.28 + ((h % 1000) / 1000) * swell * 0.7));
    });
  }, [path, n]);
}

function Recording({ r, words, controls }: { r: SearchResult; words: string[]; controls: React.MutableRefObject<PreviewControls> }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const at = secondsOf(r.location) ?? 0;
  const src = mediaUrl(r);
  const bars = useBars(r.path);
  const past = duration ? at / duration : 0.3;

  const play = () => {
    const a = audio.current;
    if (!a) return;
    if (!a.paused) {
      a.pause();
      return;
    }
    if (Math.abs(a.currentTime - at) > 2 && a.currentTime < at) a.currentTime = at;
    a.play().catch(() => {});
  };
  useEffect(() => {
    controls.current.play = play;
    return () => {
      controls.current.play = undefined;
    };
  });

  return (
    <>
      <div className="listen">
        <div className="wave" aria-hidden="true">
          {bars.map((h, i) => (
            <i key={i} className={i / bars.length <= past ? "past" : undefined} style={{ height: `${h * 100}%` }} />
          ))}
        </div>
        <div className="listen-row">
          <button type="button" className="btn play" onClick={play}>
            <Icon name={playing ? "pause" : "play"} size={14} strokeWidth={2} />
            {playing ? "Pause" : `Play from ${r.location ?? "the start"}`}
          </button>
          <span className="num">
            {r.location}
            {duration ? ` / ${clock(duration)}` : ""}
          </span>
        </div>
        {src && (
          <audio
            ref={audio}
            src={src}
            preload="metadata"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || null)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        )}
      </div>
      {r.snippet && (
        <div className="transcript selectable">
          <span className="at hit">{r.location}</span>
          <span>
            <Marked text={r.snippet.replace(/^…\s*/, "").replace(/\s*…$/, "")} words={words} />
          </span>
        </div>
      )}
    </>
  );
}

/** A video at the moment that matched; Enter in the launcher plays it here. */
function Clip({ src, controls }: { src: string; controls: React.MutableRefObject<PreviewControls> }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    controls.current.play = () => {
      const v = video.current;
      if (v) v.paused ? v.play().catch(() => {}) : v.pause();
    };
    return () => {
      controls.current.play = undefined;
    };
  });
  return (
    <div className="hero-photo">
      <video ref={video} key={src} src={src} controls preload="metadata" />
    </div>
  );
}

function Photo({ r, onSize }: { r: SearchResult; onSize: (s: string) => void }) {
  const direct = thumbnailUrl(r);
  const shell = useShellImage(r.path, 480, true);
  const src = direct ?? shell;
  return (
    <div className="hero-photo">
      {src && <img src={src} alt="" onLoad={(e) => direct && onSize(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)} />}
    </div>
  );
}

/** The details pane: the page, photo or moment that matched, why, and the file's properties. */
export function Preview({
  result: r,
  query,
  controls,
  speechModel,
}: {
  result: SearchResult;
  query: string;
  controls: React.MutableRefObject<PreviewControls>;
  speechModel?: string;
}) {
  const words = queryWords(query);
  const reason = reasonOf(r, query);
  const [dims, setDims] = useState<string | null>(null);
  useEffect(() => setDims(null), [r.path]);
  const timed = isTimestamp(r.location);
  const media = mediaUrl(r);

  return (
    <section className={`lpreview ${kindClass(r.kind)}`} key={r.path} aria-label="Details">
      {r.kind === "image" ? (
        <Photo r={r} onSize={setDims} />
      ) : r.kind === "audio" ? (
        <Recording r={r} words={words} controls={controls} />
      ) : r.kind === "video" && media ? (
        <Clip src={media} controls={controls} />
      ) : (
        <Page r={r} words={words} />
      )}

      {r.kind !== "audio" && (
        <div className="ptitle">
          <h2 className="selectable">{r.name}</h2>
          <Chips reason={reason} kind={r.kind} />
        </div>
      )}

      <dl className="meta">
        {r.kind === "image" ? (
          <>
            <dt>Taken</dt>
            <dd>{when(r.modified)}</dd>
            <dt>Folder</dt>
            <dd className="selectable" title={r.path}>
              {folderOf(r.path)}
            </dd>
          </>
        ) : r.kind === "audio" ? (
          <>
            <dt>Recorded</dt>
            <dd>{when(r.modified)}</dd>
            <dt>Folder</dt>
            <dd className="selectable" title={r.path}>
              {folderOf(r.path)}
            </dd>
          </>
        ) : (
          <>
            <dt>Folder</dt>
            <dd className="selectable" title={r.path}>
              {folderOf(r.path)}
            </dd>
            <dt>Modified</dt>
            <dd>{when(r.modified)}</dd>
          </>
        )}
        {r.kind === "audio" && timed ? (
          <>
            <dt>Transcript</dt>
            <dd>Made on this PC by {speechModel ? whisper(speechModel) : "Whisper"}</dd>
          </>
        ) : (
          <>
            <dt>Size</dt>
            <dd className="num">
              {formatSize(r.size)}
              {dims && ` · ${dims}`}
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}
