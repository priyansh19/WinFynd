import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Icon } from "../../components/Icon";
import { about, KINDS } from "../../lib/kinds";
import { setupDoneBefore } from "../../lib/onboarding";
import { estimateFolders, type FolderStats } from "../../lib/stats";
import { inTauri } from "../../lib/tauri";
import { NavButtons, Page, type StepProps } from "../Onboarding";

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
const isDownloads = (path: string) => folderName(path).toLowerCase() === "downloads";

export function FoldersStep({ config, save, next, back }: StepProps) {
  // Downloads starts unticked the first time: it's mostly installers and archives.
  const [folders, setFolders] = useState(() => {
    const first = !setupDoneBefore();
    return config.roots.map((path) => ({ path, on: !(first && isDownloads(path)) }));
  });
  const [counts, setCounts] = useState<Record<string, FolderStats>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(new Set<string>());

  // Count each folder once, in the background; big folders stop early and say "more than".
  useEffect(() => {
    const todo = folders.map((f) => f.path).filter((p) => !asked.current.has(p));
    if (!todo.length) return;
    todo.forEach((p) => asked.current.add(p));
    estimateFolders(todo)
      .then((list) => setCounts((c) => ({ ...c, ...Object.fromEntries(list.map((s, i) => [todo[i], s])) })))
      .catch(() => {});
  }, [folders]);

  const roots = folders.filter((f) => f.on).map((f) => f.path);

  const add = async () => {
    if (!inTauri) return;
    const picked = await open({ directory: true, multiple: false, title: "Choose a folder for WinFynd to search" });
    if (typeof picked !== "string") return;
    setFolders((fs) =>
      fs.some((f) => f.path === picked) ? fs.map((f) => (f.path === picked ? { ...f, on: true } : f)) : [...fs, { path: picked, on: true }],
    );
  };

  const go = async () => {
    const same = roots.length === config.roots.length && roots.every((r, i) => r === config.roots[i]);
    if (same) return next();
    setSaving(true);
    try {
      await save({ ...config, roots });
      next();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <Page footer={<NavButtons back={back} next={go} disabled={roots.length === 0 || saving} />}>
      <h1 className="setup-title">Choose what to search</h1>
      <p className="setup-lede">WinFynd reads these folders now and keeps up with new files as they appear. You can change this any time.</p>
      {error && (
        <div className="infobar error" role="alert">
          <Icon name="error" size={16} />
          <span className="grow selectable">{error}</span>
        </div>
      )}
      <div className="stack folder-picks">
        {folders.map((f) => {
          const s = counts[f.path];
          return (
            <label key={f.path} className={`card folder-pick${f.on ? "" : " off"}`}>
              <input
                type="checkbox"
                className="check"
                checked={f.on}
                onChange={() => setFolders((fs) => fs.map((x) => (x.path === f.path ? { ...x, on: !x.on } : x)))}
              />
              <Icon name="folder" size={20} className="k-amber kc" />
              <span className="grow">
                <span className="t">{folderName(f.path)}</span>
                <span className="s ellip" title={f.path}>
                  {isDownloads(f.path) ? "Installers and archives are found by name only" : f.path}
                </span>
              </span>
              <span className="folder-count">
                <span className="small muted num">{s ? `${s.partial ? "more than" : "about"} ${about(s.files)} files` : "Counting…"}</span>
                <span className={`kindbar${s?.files ? "" : " empty"}`} style={{ width: 130, height: 6 }}>
                  {KINDS.map(({ kind, cls }) => (s?.kinds[kind] ? <i key={kind} className={cls} style={{ flex: s.kinds[kind] }} /> : null))}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <div>
        <button type="button" className="btn" onClick={add}>
          <Icon name="folderAdd" />
          Add another folder
        </button>
      </div>
    </Page>
  );
}
