import { Icon, type IconName } from "../components/Icon";
import { useShellImage } from "../lib/native";
import type { ResultKind } from "../lib/search";

const KIND_ICON: Record<ResultKind, IconName> = {
  document: "document",
  slides: "slides",
  spreadsheet: "table",
  code: "code",
  image: "image",
  video: "video",
  audio: "audio",
  other: "document",
};

/** The file's icon as Explorer draws it, with a Fluent glyph until it loads (or in the browser preview). */
export function FileIcon({ path, kind, size }: { path: string; kind: ResultKind; size: number }) {
  const shell = useShellImage(path, size);
  const glyph = /\.pdf$/i.test(path) ? "pdf" : KIND_ICON[kind];
  return shell ? (
    <img className="file-icon" src={shell} width={size} height={size} alt="" />
  ) : (
    <span className="file-icon file-icon-glyph" style={{ width: size, height: size }}>
      <Icon name={glyph} size={Math.round(size * 0.75)} />
    </span>
  );
}
