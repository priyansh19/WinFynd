import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Icon } from "../../components/Icon";
import { Toggle } from "../../components/Toggle";
import { setConfig as saveConfig } from "../../lib/engine";
import { inTauri } from "../../lib/tauri";
import { Check, StepFooter, StepHeader, type StepProps } from "../Onboarding";

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function FoldersStep({ config, setConfig, next, back }: StepProps) {
  // Folders WinFynd suggested stay listed when unticked, so they're easy to add back.
  const [folders, setFolders] = useState(() => config.roots.map((path) => ({ path, on: true })));
  const [photos, setPhotos] = useState(config.indexImages);
  const [frames, setFrames] = useState(config.indexVideoFrames);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const roots = folders.filter((f) => f.on).map((f) => f.path);

  const add = async () => {
    if (!inTauri) return;
    const picked = await open({ directory: true, multiple: false, title: "Choose a folder for WinFynd to search" });
    if (typeof picked !== "string") return;
    setFolders((fs) => (fs.some((f) => f.path === picked) ? fs.map((f) => (f.path === picked ? { ...f, on: true } : f)) : [...fs, { path: picked, on: true }]));
  };

  const toggle = (path: string) => setFolders((fs) => fs.map((f) => (f.path === path ? { ...f, on: !f.on } : f)));

  const save = async () => {
    setSaving(true);
    try {
      const nextConfig = { ...config, roots, indexImages: photos, indexVideoFrames: frames && photos };
      setConfig(await saveConfig(nextConfig));
      next();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <StepHeader
        title="Choose what WinFynd can search"
        lead="WinFynd keeps an index of these folders and updates it as files are added or changed."
      />

      <section className="ob-section">
        <div className="ob-section-head">
          <h2>Folders</h2>
          <button type="button" className="ob-btn" onClick={add}>
            <Icon name="folder" size={16} />
            Add a folder
          </button>
        </div>
        <ul className="ob-card ob-list">
          {folders.length === 0 && <li className="ob-row ob-muted">No folders yet. Add one to start.</li>}
          {folders.map((f) => (
            <li key={f.path} className="ob-row">
              <label className="ob-check">
                <input type="checkbox" checked={f.on} onChange={() => toggle(f.path)} />
                <span className="ob-checkbox" aria-hidden="true">
                  <Check />
                </span>
                <span className="ob-row-icon" aria-hidden="true">
                  <Icon name="folder" size={18} />
                </span>
                <span className="ob-row-text">
                  <span className="ob-row-title">{folderName(f.path)}</span>
                  <span className="ob-muted ob-ellipsis" title={f.path}>
                    {f.path}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="ob-muted">
          Hidden folders, app data and build output are always skipped. OneDrive files that are only in the cloud are found by
          name until you download them.
        </p>
      </section>

      <section className="ob-section">
        <h2>Also look inside</h2>
        <ul className="ob-card ob-list">
          <li className="ob-row">
            <span className="ob-row-text">
              <span className="ob-row-title">Photos and images</span>
              <span className="ob-muted">Find a picture by describing it, like “dog on a beach”.</span>
            </span>
            <Toggle label="Photos and images" checked={photos} onChange={setPhotos} />
          </li>
          <li className="ob-row" aria-disabled={!photos}>
            <span className="ob-row-text">
              <span className="ob-row-title">What's shown in videos</span>
              <span className="ob-muted">
                {photos ? "Looks at frames across each video. Needs FFmpeg." : "Turn on photos and images to use this."}
              </span>
            </span>
            <Toggle label="What's shown in videos" checked={frames && photos} onChange={(v) => photos && setFrames(v)} />
          </li>
        </ul>
      </section>

      {error && (
        <p className="ob-error" role="alert">
          {error}
        </p>
      )}

      <StepFooter back={back}>
        {roots.length === 0 && <span className="ob-muted">Pick at least one folder</span>}
        <button type="button" className="ob-btn ob-btn-accent" disabled={roots.length === 0 || saving} onClick={save}>
          Next
        </button>
      </StepFooter>
    </>
  );
}
