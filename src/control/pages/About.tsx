import { useState } from "react";
import { AppIcon, Icon, type IconName } from "../../components/Icon";
import { Toggle } from "../../components/Toggle";
import { openLink, REPO, runSetup, useAppVersion, useUpdateCheck } from "../../lib/app";

function LinkCard({ icon, k, title, sub, url, setting }: { icon: IconName; k: string; title: string; sub: string; url: string; setting?: string }) {
  return (
    <div className="card" data-setting={setting}>
      <Icon name={icon} size={20} className={`${k} kc`} />
      <span className="grow">
        <span className="t">{title}</span>
        <span className="s">{sub}</span>
      </span>
      <button type="button" className="btn" onClick={() => openLink(url).catch(() => {})}>
        <Icon name="open" size={14} />
        Open
      </button>
    </div>
  );
}

/** About has no artboard of its own; it follows Privacy: a tinted hero, then plain cards. */
export function AboutPage() {
  const version = useAppVersion();
  const updates = useUpdateCheck();
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const newer = updates.release?.newer ? updates.release : null;

  const check = async () => {
    setChecking(true);
    setFailed(false);
    try {
      await updates.checkNow();
    } catch {
      setFailed(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <h1 className="h1">About</h1>
      <div className="panel about-hero">
        <AppIcon size={48} />
        <span className="hero-text">
          <span className="hero-title">WinFynd</span>
          <span className="muted num">{version ? `Version ${version} · ` : ""}Find anything on your PC by describing it.</span>
        </span>
      </div>

      <h2 className="h2">Updates</h2>
      <div className="card" data-setting="Check for updates">
        <Icon name="refresh" size={20} className="k-code kc" />
        <span className="grow">
          <span className="t">{newer ? `WinFynd ${newer.version} is out` : "Check for updates"}</span>
          <span className="s">
            {failed
              ? "Couldn't reach GitHub. Try again later."
              : newer
                ? "Download it from the release page. Your index, folders and settings are kept."
                : updates.release && updates.enabled
                  ? "You have the newest version. WinFynd looks once a day."
                  : "Looks at WinFynd's releases on GitHub once a day. Nothing about you is sent."}
          </span>
        </span>
        {newer ? (
          <button type="button" className="btn accent" onClick={() => openLink(newer.url).catch(() => {})}>
            <Icon name="download" />
            Get {newer.version}
          </button>
        ) : (
          <button type="button" className="btn" disabled={checking} onClick={check}>
            {checking ? "Checking…" : "Check now"}
          </button>
        )}
        <Toggle label="Check for updates once a day" checked={updates.enabled} onChange={updates.setEnabled} />
      </div>

      <h2 className="h2">Help</h2>
      <div className="stack">
        <LinkCard icon="warning" k="k-amber" title="Report a problem" sub="Opens a new issue on GitHub. Say what you searched and what you expected." url={`${REPO}/issues/new`} setting="Report a problem" />
        <LinkCard icon="doc" k="k-doc" title="Release notes" sub="What changed in each version" url={`${REPO}/releases`} />
        <LinkCard icon="github" k="k-other" title="Source code" sub="github.com/priyansh19/WinFynd" url={REPO} />
      </div>

      <h2 className="h2">This app</h2>
      <div className="card" data-setting="Run setup again">
        <Icon name="sparkle" size={20} className="k-img kc" />
        <span className="grow">
          <span className="t">Run setup again</span>
          <span className="s">Pick folders, models and shortcuts again. What's already read is kept.</span>
        </span>
        <button type="button" className="btn" onClick={() => runSetup().catch(() => {})}>
          Run setup
        </button>
      </div>
      <p className="small faint about-foot">Built with Tauri, Ollama, EmbeddingGemma 2 and Whisper. Everything runs on this PC.</p>
    </>
  );
}
