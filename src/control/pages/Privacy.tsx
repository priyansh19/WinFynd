import { useState } from "react";
import { Icon } from "../../components/Icon";
import { Toggle } from "../../components/Toggle";
import { checksForUpdates } from "../../lib/app";
import { formatBytes, useEngineConfig } from "../../lib/engine";
import { confirmNative } from "../../lib/native";
import { clearRecent, recentSearches, remembersSearches, setRemembersSearches } from "../../lib/recent";
import { deleteIndex, useIndexStats } from "../../lib/stats";

function Connection({
  icon,
  k,
  title,
  sub,
  when,
  local,
}: {
  icon: "cube" | "download" | "refresh";
  k: string;
  title: string;
  sub: string;
  when: string;
  local?: boolean;
}) {
  return (
    <div className="card">
      <Icon name={icon} size={20} className={`${k} kc`} />
      <span className="grow">
        <span className="t">{title}</span>
        <span className="s selectable">{sub}</span>
      </span>
      <span className="small muted when">{when}</span>
      {local ? (
        <span className="chip" style={{ ["--k" as string]: "var(--ok)" }}>
          <Icon name="lock" size={12} />
          On this PC
        </span>
      ) : (
        <span className="chip k-other">
          <Icon name="globe" size={12} />
          Internet
        </span>
      )}
    </div>
  );
}

export function PrivacyPage() {
  const [config] = useEngineConfig();
  const stats = useIndexStats(false);
  const [remember, setRemember] = useState(remembersSearches);
  const [hasHistory, setHasHistory] = useState(() => recentSearches().length > 0);
  const [deleted, setDeleted] = useState(false);
  const host = (config?.ollamaUrl ?? "http://127.0.0.1:11434").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const size = formatBytes(stats?.indexBytes ?? 0);

  return (
    <>
      <h1 className="h1">Privacy</h1>
      <div className="panel privacy-hero">
        <Icon name="shield" size={44} strokeWidth={1.4} style={{ color: "#3dd68c", flex: "none" }} />
        <span className="hero-text">
          <span className="hero-title">Your files never leave this PC</span>
          <span className="muted">These are the only connections WinFynd makes. There is no account, no analytics and no cloud index.</span>
        </span>
      </div>

      <h2 className="h2" data-setting="Connections">
        Connections
      </h2>
      <div className="stack">
        <Connection icon="cube" k="k-audio" title="Ollama" sub={`${host} · embeddings and answers`} when="Every search" local />
        <Connection icon="download" k="k-doc" title="Model downloads" sub="ollama.com and huggingface.co" when="Only when you click Download" />
        <Connection
          icon="refresh"
          k="k-code"
          title="Update check"
          sub="github.com/priyansh19/WinFynd releases"
          when={checksForUpdates() ? "Once a day, can be turned off" : "Off"}
        />
      </div>

      <h2 className="h2">Your data</h2>
      <div className="stack">
        <div className="card" data-setting="Remember recent searches">
          <Icon name="clock" size={20} className="k-amber kc" />
          <span className="grow">
            <span className="t">Remember recent searches</span>
            <span className="s">Kept on this PC to suggest searches you repeat</span>
          </span>
          <button
            type="button"
            className="btn"
            disabled={!hasHistory}
            onClick={() => {
              clearRecent();
              setHasHistory(false);
            }}
          >
            Clear history
          </button>
          <Toggle
            label="Remember recent searches"
            checked={remember}
            onChange={(v) => {
              setRemembersSearches(v);
              setRemember(v);
              if (!v) setHasHistory(false);
            }}
          />
        </div>
        <div className="card" data-setting="Delete the index">
          <Icon name="trash" size={20} className="k-video kc" />
          <span className="grow">
            <span className="t">Delete the index</span>
            <span className="s num">
              {deleted ? "Deleted. Your folders are being read again from the start." : `Removes ${size} of search data. Your files are not touched.`}
            </span>
          </span>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const ok = await confirmNative(
                "WinFynd forgets everything it has read and starts reading your folders again. Your files are not touched.",
                "Delete the index?",
                "Delete index",
              );
              if (!ok) return;
              await deleteIndex();
              setDeleted(true);
            }}
          >
            Delete index
          </button>
        </div>
      </div>
    </>
  );
}
