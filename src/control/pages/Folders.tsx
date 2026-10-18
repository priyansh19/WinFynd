import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Icon } from "../../components/Icon";
import { Menu } from "../../components/Menu";
import { Toggle } from "../../components/Toggle";
import { isBusy, mediaSupport, rescan, useEngineConfig, type EngineConfig, type EngineStatus, type MediaSupport } from "../../lib/engine";
import { KINDS } from "../../lib/kinds";
import { confirmNative } from "../../lib/native";
import { openResult } from "../../lib/search";
import { driveName, driveUsage, onDrive, useDrives, useIndexStats, type Drive } from "../../lib/stats";
import { inTauri } from "../../lib/tauri";
import { folderName } from "./Home";

/** What the indexer always skips (engine `is_excluded` and hidden files), in words. */
const SKIPPED = [
  "Windows, Program Files, ProgramData and the Recycle Bin",
  "AppData and everything else File Explorer hides, plus folders starting with a dot",
  "Recovery, Windows.old, update leftovers and the page file",
  "node_modules, vendor, venv, site-packages and other dependencies",
  "Build output: target, bin, obj, dist, build, coverage",
  "Game libraries from Steam, Epic Games and Xbox",
  "Office lock files (~$…) and OneDrive's temporary folder",
];

type MenuFor = { path: string; drive: Drive | null; right: number; top: number };

export function FoldersPage({ status }: { status: EngineStatus | null }) {
  const [config, save] = useEngineConfig();
  const stats = useIndexStats(isBusy(status));
  const drives = useDrives();
  const [media, setMedia] = useState<MediaSupport | null>(null);
  const [menu, setMenu] = useState<MenuFor | null>(null);
  const [editSkip, setEditSkip] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mediaSupport()
      .then(setMedia)
      .catch(() => {});
  }, []);

  if (!config) return null;

  const update = async (next: EngineConfig, rebuild = false) => {
    if (
      rebuild &&
      !(await confirmNative(
        "Changing this reads all your files again. Search keeps working meanwhile, with some results missing until it finishes.",
        "Read your files again?",
        "Read again",
      ))
    )
      return;
    try {
      await save(next);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const addFolder = async () => {
    if (!inTauri) return;
    const picked = await open({ directory: true, multiple: false, title: "Choose a folder for WinFynd to search" });
    if (typeof picked === "string" && !config.roots.includes(picked)) update({ ...config, roots: [...config.roots, picked] });
  };

  const whole = config.wholePc;
  const isSkipped = (path: string) => config.skip.some((s) => s.toLowerCase() === path.toLowerCase());
  const skip = (path: string) => !isSkipped(path) && update({ ...config, skip: [...config.skip, path] });
  const unskip = (path: string) => update({ ...config, skip: config.skip.filter((s) => s.toLowerCase() !== path.toLowerCase()) });
  // With full OS context on, chosen folders still count when they're off the drives (a network folder).
  const folders = whole ? config.roots.filter((r) => !(drives ?? []).some((d) => onDrive(r, d))) : config.roots;

  const setWhole = async (on: boolean) => {
    if (
      !on &&
      !(await confirmNative(
        "WinFynd forgets what it read outside the folders you choose. The files themselves are not touched.",
        "Search only chosen folders?",
        "Turn off",
      ))
    )
      return;
    update({ ...config, wholePc: on });
  };

  const skipAFolder = async () => {
    if (!inTauri) return;
    const picked = await open({ directory: true, multiple: false, title: "Choose a folder for WinFynd to skip" });
    if (typeof picked === "string") skip(picked);
  };

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>, path: string, drive: Drive | null) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ path, drive, right: window.innerWidth - r.right, top: r.bottom + 4 });
  };

  const count = (path: string) => {
    const s = stats?.folders.find((f) => f.path === path);
    return (
      <div className="folder-count">
        <span className="small muted num">{s ? `${s.files.toLocaleString()} files` : "Counting…"}</span>
        <div className={`kindbar${s?.files ? "" : " empty"}`} style={{ width: 140, height: 6 }}>
          {KINDS.map(({ kind, cls }) => (s?.kinds[kind] ? <i key={kind} className={cls} style={{ flex: s.kinds[kind] }} /> : null))}
        </div>
      </div>
    );
  };
  const more = (label: string, onClick: (e: React.MouseEvent<HTMLButtonElement>) => void) => (
    <button type="button" className="btn subtle" aria-label={`More options for ${label}`} aria-haspopup="menu" style={{ padding: "0 8px" }} onClick={onClick}>
      <Icon name="more" />
    </button>
  );

  const installedSpeech = media?.speechModels.find((m) => m.installed);
  const speechOn = !!config.speechModel;
  const framesPossible = !!media?.ffmpeg && config.indexImages;
  // The smallest search model reads text only; photos need a bigger one.
  const textOnly = config.embedModel.endsWith(":270m");

  return (
    <>
      <div className="h1row">
        <h1 className="h1">Folders</h1>
        {!whole && (
          <button type="button" className="btn accent" onClick={addFolder} data-setting="Add a folder">
            <Icon name="folderAdd" />
            Add a folder
          </button>
        )}
      </div>
      <p className="lede">
        {whole
          ? "WinFynd reads every drive on this PC and reads new or changed files within seconds."
          : "WinFynd watches these folders and reads new or changed files within seconds."}
      </p>
      {error && (
        <div className="infobar error" role="alert" style={{ marginBottom: 8 }}>
          <Icon name="error" size={16} />
          <span className="grow selectable">{error}</span>
        </div>
      )}

      <div className="stack">
        <div className={`card full-os${whole ? " on" : ""}`} data-setting="Allow full OS context">
          <Icon name="pc" size={20} className="k-doc kc" />
          <span className="grow">
            <span className="t">Allow full OS context</span>
            <span className="s">
              {whole ? "Search all of C: and every other drive. Turn off to choose folders instead." : "Off. WinFynd searches only the folders below."}
            </span>
          </span>
          {/* With the whole PC on there's no folder to add: "Add a folder" points here, where it turns off. */}
          <span className="toggle-target" data-setting={whole ? "Add a folder" : undefined}>
            <Toggle label="Allow full OS context" checked={whole} onChange={setWhole} />
          </span>
        </div>
        {whole &&
          drives?.map((d) => {
            const off = isSkipped(d.path);
            return (
              <div key={d.path} className={`card drive${off ? " off" : ""}`}>
                <Icon name="drive" size={20} className="k-amber kc" />
                <span className="grow">
                  <span className="t">{driveName(d)}</span>
                  <span className="s">{driveUsage(d)}</span>
                </span>
                {off ? <span className="small muted">Skipped</span> : count(d.path)}
                {more(driveName(d), (e) => openMenu(e, d.path, d))}
              </div>
            );
          })}
        {folders.map((root) => (
          <div key={root} className="card">
            <Icon name="folder" size={20} className="k-amber kc" />
            <span className="grow">
              <span className="t">{folderName(root)}</span>
              <span className="s ellip selectable" title={root}>
                {root}
              </span>
            </span>
            {count(root)}
            {more(folderName(root), (e) => openMenu(e, root, null))}
          </div>
        ))}
        {!whole && config.roots.length === 0 && (
          <div className="card">
            <Icon name="folderAdd" size={20} className="k-amber kc" />
            <span className="grow">
              <span className="t">No folders yet</span>
              <span className="s">Add Documents, Pictures or any folder you keep files in.</span>
            </span>
          </div>
        )}
      </div>

      <h2 className="h2">What WinFynd reads</h2>
      <div className="stack">
        <div className="card" data-setting="What's in photos">
          <Icon name="photo" size={20} className="k-img kc" />
          <span className="grow">
            <span className="t">What's in photos</span>
            <span className="s">
              {textOnly ? "Needs the Balanced or Most accurate search model. Change it in Models." : "Find photos by describing them, like “receipt on a table”"}
            </span>
          </span>
          <Toggle
            label="What's in photos"
            checked={config.indexImages && !textOnly}
            disabled={textOnly && !config.indexImages}
            onChange={(v) => update({ ...config, indexImages: v }, true)}
          />
        </div>
        <div className="card" data-setting="Speech in recordings and videos">
          <Icon name="wave" size={20} className="k-audio kc" />
          <span className="grow">
            <span className="t">Speech in recordings and videos</span>
            <span className="s">
              {speechOn || installedSpeech ? "Turns speech into searchable text with Whisper" : "Turns speech into searchable text with Whisper. Download it in Models first."}
            </span>
          </span>
          <Toggle
            label="Speech in recordings and videos"
            checked={speechOn}
            disabled={!speechOn && !installedSpeech}
            onChange={(v) => update({ ...config, speechModel: v ? (installedSpeech?.id ?? "") : "" })}
          />
        </div>
        <div className="card" data-setting="Frames in videos">
          <Icon name="video" size={20} className="k-video kc" />
          <span className="grow">
            <span className="t">Frames in videos</span>
            <span className="s">
              {media && !media.ffmpeg
                ? "Finds the moment something appears. Needs FFmpeg: winget install Gyan.FFmpeg"
                : !config.indexImages
                  ? "Finds the moment something appears. Needs “What's in photos” on."
                  : "Finds the moment something appears. Needs FFmpeg."}
            </span>
          </span>
          <Toggle
            label="Frames in videos"
            checked={config.indexVideoFrames && framesPossible}
            disabled={!framesPossible}
            onChange={(v) => update({ ...config, indexVideoFrames: v })}
          />
        </div>
      </div>

      <h2 className="h2">Skipped</h2>
      <div className="stack">
        <div className="card" data-setting="System and app folders" style={{ flexWrap: "wrap" }}>
          <Icon name="lock" size={20} className="k-other kc" />
          <span className="grow">
            <span className="t">System and app folders</span>
            <span className="s">
              Hidden folders, AppData, node_modules, build output and caches
              {config.skip.length ? `, plus ${config.skip.length === 1 ? "1 folder" : `${config.skip.length} folders`} you chose` : ""}
            </span>
          </span>
          <button type="button" className="btn" aria-expanded={editSkip} onClick={() => setEditSkip((v) => !v)}>
            {editSkip ? "Done" : "Edit list"}
          </button>
          {editSkip && (
            <div className="skip-edit">
              <span className="small faint">Always skipped</span>
              <ul className="skipped">
                {SKIPPED.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <span className="small faint">Skipped by you</span>
              {config.skip.length ? (
                config.skip.map((p) => {
                  const d = drives?.find((x) => x.path.toLowerCase() === p.toLowerCase());
                  return (
                    <div key={p} className="skip-row">
                      <Icon name={d ? "drive" : "folder"} size={16} className="k-amber kc" />
                      <span className="grow ellip selectable small" title={p}>
                        {d ? driveName(d) : p}
                      </span>
                      <button type="button" className="btn subtle" onClick={() => unskip(p)}>
                        Search again
                      </button>
                    </div>
                  );
                })
              ) : (
                <span className="small muted">Nothing yet. Skip a folder to keep WinFynd out of it, like a game library or old backups.</span>
              )}
              <div>
                <button type="button" className="btn" onClick={skipAFolder}>
                  <Icon name="folderAdd" />
                  Skip a folder
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="card" data-setting="OneDrive files that are only online">
          <Icon name="globe" size={20} className="k-doc kc" />
          <span className="grow">
            <span className="t">OneDrive files that are only online</span>
            <span className="s">Off: found by name only, nothing is downloaded. On: downloads each file to read it.</span>
          </span>
          <Toggle
            label="OneDrive files that are only online"
            checked={config.readOnlineFiles}
            onChange={(v) => update({ ...config, readOnlineFiles: v })}
          />
        </div>
      </div>

      {menu && (
        <Menu
          label={`Options for ${menu.drive ? driveName(menu.drive) : folderName(menu.path)}`}
          style={{ position: "fixed", right: menu.right, top: menu.top }}
          onClose={() => setMenu(null)}
          items={
            menu.drive && isSkipped(menu.path)
              ? [{ label: "Search this drive again", icon: "refresh", run: () => unskip(menu.path) }]
              : [
                  { label: "Open in File Explorer", icon: "open", run: () => openResult(menu.path).catch((e) => setError(String(e))) },
                  { label: "Look for changes now", icon: "refresh", run: () => rescan() },
                  menu.drive
                    ? {
                        label: "Skip this drive",
                        icon: "close",
                        run: async () => {
                          const name = driveName(menu.drive!);
                          const ok = await confirmNative(`WinFynd forgets what it read on ${name}. The files themselves are not touched.`, "Skip this drive?", "Skip drive");
                          if (ok) skip(menu.path);
                        },
                      }
                    : {
                        label: "Stop watching",
                        icon: "close",
                        run: async () => {
                          const ok = await confirmNative(
                            `WinFynd forgets what it read in ${folderName(menu.path)}. The files themselves are not touched.`,
                            "Stop watching this folder?",
                            "Stop watching",
                          );
                          if (ok) update({ ...config, roots: config.roots.filter((r) => r !== menu.path) });
                        },
                      },
                ]
          }
        />
      )}
    </>
  );
}
