import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Icon } from "../../components/Icon";
import { Toggle } from "../../components/Toggle";
import { about, KINDS, type KindCounts } from "../../lib/kinds";
import { driveName, driveUsage, estimateFolders, useDrives, type Drive, type FolderStats } from "../../lib/stats";
import { inTauri } from "../../lib/tauri";
import { NavButtons, Page, type StepProps } from "../Onboarding";

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

// Kept for as long as the window is open, so going back doesn't count again
// or lose a folder the user unticked.
const counted = new Map<string, FolderStats>();
const ticked = new Map<string, boolean>();

/** "mostly photos and videos": the two biggest kinds a drive holds, when they stand out. */
function mostly(kinds: KindCounts): string {
  const total = Object.values(kinds).reduce((a, b) => a + (b ?? 0), 0);
  const top = KINDS.filter((k) => k.kind !== "other" && (kinds[k.kind] ?? 0) >= total * 0.1)
    .sort((a, b) => (kinds[b.kind] ?? 0) - (kinds[a.kind] ?? 0))
    .slice(0, 2)
    .map((k) => k.label.toLowerCase());
  return top.length ? `mostly ${top.join(" and ")}` : "";
}

export function FoldersStep({ config, save, next, back }: StepProps) {
  const [whole, setWhole] = useState(config.wholePc);
  const [folders, setFolders] = useState(() => {
    config.roots.forEach((p) => ticked.set(p, ticked.get(p) ?? true));
    return [...ticked].map(([path, on]) => ({ path, on }));
  });
  const [counts, setCounts] = useState<Record<string, FolderStats>>(() => Object.fromEntries(counted));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allDrives = useDrives();
  const drives = (allDrives ?? []).filter((d) => !config.skip.includes(d.path));

  // Count what's on show, once each, in the background; big ones stop early and say "more than".
  const shown = whole ? drives.map((d) => d.path) : folders.map((f) => f.path);
  const todo = shown.filter((p) => !counted.has(p)).join("\n");
  useEffect(() => {
    if (!todo) return;
    const paths = todo.split("\n");
    paths.forEach((p) => counted.set(p, { path: p, files: 0, kinds: {}, partial: true }));
    estimateFolders(paths)
      .then((list) => {
        list.forEach((s, i) => counted.set(paths[i], s));
        setCounts(Object.fromEntries(counted));
      })
      .catch(() => paths.forEach((p) => counted.delete(p)));
  }, [todo]);

  const roots = folders.filter((f) => f.on).map((f) => f.path);
  const oneDrive = config.roots.some((r) => /[\\/]OneDrive/i.test(r));

  const tick = (path: string, on: boolean) => {
    ticked.set(path, on);
    setFolders([...ticked].map(([p, o]) => ({ path: p, on: o })));
  };

  const add = async () => {
    if (!inTauri) return;
    const picked = await open({ directory: true, multiple: false, title: "Choose a folder for WinFynd to search" });
    if (typeof picked === "string") tick(picked, true);
  };

  const go = async () => {
    const nextRoots = whole ? config.roots : roots;
    const same = whole === config.wholePc && nextRoots.length === config.roots.length && nextRoots.every((r, i) => r === config.roots[i]);
    if (same) return next();
    setSaving(true);
    try {
      await save({ ...config, wholePc: whole, roots: nextRoots });
      next();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  const count = (s: FolderStats | undefined) =>
    !s || (s.partial && !s.files) ? "Counting…" : `${s.partial ? "more than" : "about"} ${about(s.files)} files`;
  const bar = (s: FolderStats | undefined, width: number) => (
    <span className={`kindbar${s?.files ? "" : " empty"}`} style={{ width, height: 6 }}>
      {KINDS.map(({ kind, cls }) => (s?.kinds[kind] ? <i key={kind} className={cls} style={{ flex: s.kinds[kind] }} /> : null))}
    </span>
  );
  const driveSub = (d: Drive) => {
    const what = d.system ? (oneDrive ? "your user folders, OneDrive and apps" : "your user folders and apps") : mostly(counts[d.path]?.kinds ?? {});
    return what ? `${driveUsage(d)} · ${what}` : driveUsage(d);
  };

  return (
    <Page footer={<NavButtons back={back} next={go} disabled={(!whole && roots.length === 0) || saving} />}>
      <h1 className="setup-title">Choose what to search</h1>
      <p className="setup-lede">
        {whole
          ? "WinFynd reads every drive on this PC and keeps up with new files as they appear. Everything it reads stays here."
          : "WinFynd reads only the folders you pick and keeps up with new files in them. You can switch to the whole PC any time."}
      </p>
      {error && (
        <div className="infobar error" role="alert">
          <Icon name="error" size={16} />
          <span className="grow selectable">{error}</span>
        </div>
      )}
      <div className="stack folder-picks">
        <div className={`card full-os${whole ? " on" : ""}`}>
          <Icon name="pc" size={20} className="k-doc kc" />
          <span className="grow">
            <span className="t">Allow full OS context</span>
            <span className="s">{whole ? "Search all of C: and every other drive. Recommended." : "Off. WinFynd searches only the folders below."}</span>
          </span>
          <Toggle label="Allow full OS context" checked={whole} onChange={setWhole} />
        </div>
        {whole
          ? drives.map((d) => (
              <div key={d.path} className="card drive-pick">
                <Icon name="drive" size={20} className="k-amber kc" />
                <span className="grow">
                  <span className="t">{driveName(d)}</span>
                  <span className="s ellip">{driveSub(d)}</span>
                </span>
                <span className="folder-count drive-count">
                  <span className="small muted num">{count(counts[d.path])}</span>
                  {bar(counts[d.path], 150)}
                </span>
              </div>
            ))
          : folders.map((f) => (
              <label key={f.path} className={`card folder-pick${f.on ? "" : " off"}`}>
                <input type="checkbox" className="check" checked={f.on} onChange={() => tick(f.path, !f.on)} />
                <Icon name="folder" size={20} className="k-amber kc" />
                <span className="grow">
                  <span className="t">{folderName(f.path)}</span>
                  <span className="s ellip" title={f.path}>
                    {f.path}
                  </span>
                </span>
                <span className="folder-count">
                  <span className="small muted num">{count(counts[f.path])}</span>
                  {bar(counts[f.path], 130)}
                </span>
              </label>
            ))}
      </div>
      {whole ? (
        <div className="small muted always-skipped">
          <Icon name="lock" size={14} strokeWidth={1.5} />
          <span>Always skipped: Windows, Program Files, AppData, the Recycle Bin, folders that start with a dot, node_modules, build output and caches. Change the list in Settings.</span>
        </div>
      ) : (
        <div>
          <button type="button" className="btn" onClick={add}>
            <Icon name="folderAdd" />
            Add a folder
          </button>
        </div>
      )}
    </Page>
  );
}
