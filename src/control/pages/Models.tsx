import { useCallback, useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { Bar } from "../../components/Progress";
import { ComboBox } from "../../components/Toggle";
import {
  downloadSpeechModel,
  formatBytes,
  getConfig,
  listModels,
  mediaSupport,
  pullModel,
  setConfig,
  useEngineConfig,
  type EngineConfig,
  type InstalledModel,
  type MediaSupport,
  type PullProgress,
  type SpeechProgress,
} from "../../lib/engine";
import { confirmNative } from "../../lib/native";
import { modelLabel } from "../../lib/search";
import { ollamaInfo, useIndexStats } from "../../lib/stats";
import { listen } from "../../lib/tauri";

// EmbeddingGemma 2 sizes in Ollama. Only the larger two can read photos.
const EMBED = [
  { tag: "embeddinggemma-2", label: "Most accurate (740M)", size: "1.3 GB", images: true },
  { tag: "embeddinggemma-2:440m", label: "Balanced (440M)", size: "0.7 GB", images: true },
  { tag: "embeddinggemma-2:270m", label: "Smallest, text only (270M)", size: "0.3 GB", images: false },
];

const SPEECH_CHOICE: Record<string, string> = { base: "Fastest", small: "Balanced", "large-v3-turbo-q5_0": "Most accurate" };

const DIMENSIONS: { value: EngineConfig["dimensions"]; label: string }[] = [
  { value: 768, label: "Most accurate" },
  { value: 512, label: "Balanced" },
  { value: 256, label: "Smaller" },
  { value: 128, label: "Smallest" },
];

const has = (installed: InstalledModel[] | null, name: string) =>
  installed?.find((m) => m.name === name || m.name === `${name}:latest`);

const REBUILD = "Changing this reads all your files again. Search keeps working meanwhile, with some results missing until it finishes.";

// A model picked before it was downloaded is switched to once the download
// finishes. Settings shows one page at a time and a download can outlast
// this one, so the switch is made here rather than in the page.
const wanted: { embed?: string; speech?: string } = {};
let reportError: (error: string | null) => void = () => {};

async function switchTo(change: (c: EngineConfig) => EngineConfig, rebuild = false) {
  if (rebuild && !(await confirmNative(REBUILD, "Read your files again?", "Read again"))) return;
  try {
    await setConfig(change(await getConfig()));
    reportError(null);
  } catch (e) {
    reportError(String(e));
  }
}

listen<PullProgress>("models://pull", (p) => {
  if (!p.done || wanted.embed !== p.model) return;
  wanted.embed = undefined;
  const m = EMBED.find((e) => e.tag === p.model);
  if (!p.error) switchTo((c) => ({ ...c, embedModel: p.model, indexImages: !!m?.images && c.indexImages }), true);
});
listen<SpeechProgress>("models://speech", (p) => {
  if (!p.done || wanted.speech !== p.id) return;
  wanted.speech = undefined;
  if (!p.error) switchTo((c) => ({ ...c, speechModel: p.id }));
});

function InUse({ label = "In use" }: { label?: string }) {
  return (
    <span className="status small muted">
      <span className="dot" style={{ background: "var(--ok)" }} />
      {label}
    </span>
  );
}

function Downloading({ completed, total }: { completed: number; total: number }) {
  return (
    <div className="downloading">
      <span className="small muted num">{total ? `Downloading · ${formatBytes(completed)} of ${formatBytes(total)}` : "Starting the download…"}</span>
      <Bar label="Download" live value={total ? (completed / total) * 100 : undefined} />
    </div>
  );
}

export function ModelsPage() {
  const [config, save] = useEngineConfig();
  const stats = useIndexStats(false);
  const [installed, setInstalled] = useState<InstalledModel[] | null>(null);
  const [ollama, setOllama] = useState<{ checked: boolean; version: string | null; error: string | null }>({ checked: false, version: null, error: null });
  const [media, setMedia] = useState<MediaSupport | null>(null);
  const [pull, setPull] = useState<PullProgress | null>(null);
  const [speechPull, setSpeechPull] = useState<SpeechProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listModels()
      .then((m) => {
        setInstalled(m.installed);
        setOllama((o) => ({ ...o, checked: true, error: m.error }));
      })
      .catch(() => {});
    ollamaInfo()
      .then((i) => setOllama((o) => ({ ...o, version: i.version })))
      .catch(() => {});
  }, []);

  const apply = useCallback(
    async (next: EngineConfig, rebuild = false) => {
      if (rebuild && !(await confirmNative(REBUILD, "Read your files again?", "Read again"))) return;
      try {
        await save(next);
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    },
    [save],
  );

  useEffect(() => {
    reportError = setError;
    refresh();
    mediaSupport()
      .then(setMedia)
      .catch(() => {});
    const offPull = listen<PullProgress>("models://pull", (p) => {
      setPull(p.done && !p.error ? null : p);
      if (p.done) refresh();
    });
    const offSpeech = listen<SpeechProgress>("models://speech", (p) => {
      setSpeechPull(p.done && !p.error ? null : p);
      if (!p.done) return;
      mediaSupport()
        .then(setMedia)
        .catch(() => {});
    });
    return () => {
      reportError = () => {};
      offPull.then((f) => f());
      offSpeech.then((f) => f());
    };
  }, [refresh]);

  if (!config) return null;

  const download = async (model: string) => {
    setPull({ model, status: "starting", completed: 0, total: 0, done: false, error: null });
    try {
      await pullModel(model);
    } catch (e) {
      if (wanted.embed === model) wanted.embed = undefined;
      setPull(null);
      setError(String(e));
    }
  };

  const downloadSpeech = async (id: string) => {
    setSpeechPull({ id, completed: 0, total: 0, done: false, error: null });
    try {
      await downloadSpeechModel(id);
    } catch (e) {
      if (wanted.speech === id) wanted.speech = undefined;
      setSpeechPull(null);
      setError(String(e));
    }
  };

  const embed = EMBED.find((e) => e.tag === config.embedModel) ?? EMBED[0];
  const embedHave = has(installed, config.embedModel);
  const pullingEmbed = pull && !pull.done && EMBED.some((e) => e.tag === pull.model) ? pull : null;
  const chatModels = (installed ?? []).filter((m) => !m.name.includes("embed"));
  const chat = has(installed, config.chatModel);
  const speechModels = media?.speechModels ?? [];
  const speech = speechModels.find((m) => m.id === config.speechModel) ?? speechModels.find((m) => m.installed) ?? speechModels.find((m) => m.id === "small");
  const speechActive = !!config.speechModel && !!speech?.installed && speech.id === config.speechModel;
  const modelBytes = (embedHave?.size ?? 0) + (chat?.size ?? chatModels[0]?.size ?? 0) + (speech?.installed ? speech.sizeMb * 1024 * 1024 : 0);
  const offline = ollama.checked && !!ollama.error;

  return (
    <>
      <h1 className="h1">Models</h1>
      <p className="lede">Every model runs on this PC. Nothing you search, say or index leaves it.</p>

      {offline ? (
        <div className="infobar error">
          <Icon name="error" size={16} />
          <span className="grow">
            <strong>Ollama isn't running.</strong>{" "}
            <span className="muted">Install it from ollama.com and start it. Until then WinFynd finds files by name and exact words.</span>
          </span>
          <button type="button" className="btn" onClick={refresh}>
            Check again
          </button>
        </div>
      ) : (
        ollama.checked && (
          <div className="infobar">
            <Icon name="check" size={16} strokeWidth={2} style={{ color: "var(--ok)" }} />
            <span>
              <strong>Ollama is running</strong> <span className="muted">on this PC{ollama.version ? `, version ${ollama.version}` : ""}</span>
            </span>
          </div>
        )
      )}
      {error && (
        <div className="infobar error" role="alert" style={{ marginTop: 8 }}>
          <Icon name="error" size={16} />
          <span className="grow selectable">{error}</span>
        </div>
      )}

      <h2 className="h2">Search</h2>
      <div className="card" data-setting="Search model">
        <Icon name="cube" size={20} className="k-audio kc" />
        <span className="grow">
          <span className="t">EmbeddingGemma 2</span>
          <span className="s">
            {embed.images ? "Understands text and photos so you can search by meaning" : "Understands text so you can search by meaning"} · {embed.size}
          </span>
        </span>
        {pullingEmbed ? (
          <Downloading completed={pullingEmbed.completed} total={pullingEmbed.total} />
        ) : embedHave ? (
          <InUse />
        ) : (
          installed && (
            <button type="button" className="btn accent" disabled={offline} onClick={() => download(config.embedModel)}>
              <Icon name="download" />
              Download
            </button>
          )
        )}
        <ComboBox
          label="Search model size"
          width={220}
          value={wanted.embed ?? config.embedModel}
          disabled={!!pullingEmbed}
          options={EMBED.map((e) => ({ value: e.tag, label: e.label }))}
          onChange={(tag) => {
            const m = EMBED.find((e) => e.tag === tag)!;
            if (has(installed, tag)) {
              wanted.embed = undefined;
              apply({ ...config, embedModel: tag, indexImages: m.images && config.indexImages }, true);
            } else {
              wanted.embed = tag;
              download(tag);
            }
          }}
        />
      </div>
      {pull?.error && <p className="error-line">The download stopped: {pull.error}</p>}

      <h2 className="h2">Answers</h2>
      <div className="card" data-setting="Ask model">
        <Icon name="sparkle" size={20} className="k-doc kc" />
        <span className="grow">
          <span className="t">Ask model</span>
          <span className="s">{chatModels.length || !installed ? "Writes answers from your files, with sources" : "No chat model on this PC yet. Llama 3.2 3B is a good start at 2.0 GB."}</span>
        </span>
        {pull && !pull.done && pull.model === "llama3.2:3b" ? (
          <Downloading completed={pull.completed} total={pull.total} />
        ) : chatModels.length ? (
          <ComboBox
            label="Ask model"
            width={220}
            value={config.chatModel}
            options={[
              ...(chat || !config.chatModel ? [] : [{ value: config.chatModel, label: `${modelLabel(config.chatModel)} · not downloaded` }]),
              { value: "", label: "First one installed" },
              ...chatModels.map((m) => ({ value: m.name, label: `${modelLabel(m.name)} · ${formatBytes(m.size)}` })),
            ]}
            onChange={(v) => apply({ ...config, chatModel: v })}
          />
        ) : (
          installed && (
            <button type="button" className="btn accent" disabled={offline} onClick={() => download("llama3.2:3b")}>
              <Icon name="download" />
              Download llama3.2 3B
            </button>
          )
        )}
      </div>

      <h2 className="h2">Speech</h2>
      <div className="stack">
        {speech && (
          <div className="card k-audio" data-setting="Whisper">
            <Icon name="wave" size={20} className="k-audio kc" />
            <span className="grow">
              <span className="t">{speech.label}</span>
              <span className="s num">Recordings, videos and voice search · {speech.sizeMb} MB</span>
            </span>
            {speechPull && !speechPull.done ? (
              <Downloading completed={speechPull.completed} total={speechPull.total} />
            ) : speechActive ? (
              <InUse />
            ) : speech.installed ? (
              <button type="button" className="btn" onClick={() => apply({ ...config, speechModel: speech.id })}>
                Use
              </button>
            ) : (
              <button type="button" className="btn accent" onClick={() => downloadSpeech(speech.id)}>
                <Icon name="download" />
                Download
              </button>
            )}
            <ComboBox
              label="Speech model"
              width={180}
              value={speech.id}
              disabled={!!speechPull && !speechPull.done}
              options={speechModels.map((m) => ({ value: m.id, label: SPEECH_CHOICE[m.id] ?? m.label }))}
              onChange={(id) => {
                const m = speechModels.find((x) => x.id === id);
                if (m?.installed) apply({ ...config, speechModel: id });
                else {
                  wanted.speech = id;
                  downloadSpeech(id);
                }
              }}
            />
          </div>
        )}
        {speechPull?.error && <p className="error-line">The download stopped: {speechPull.error}</p>}
        <div className="card" data-setting="FFmpeg">
          <Icon name="video" size={20} className="k-video kc" />
          <span className="grow">
            <span className="t">FFmpeg</span>
            <span className="s">
              {media && !media.ffmpeg ? (
                <>
                  Reads frames from videos. Install it with <code className="selectable">winget install Gyan.FFmpeg</code>, then check again.
                </>
              ) : (
                "Reads frames from videos and less common audio formats"
              )}
            </span>
          </span>
          {media?.ffmpeg ? (
            <span title={media.ffmpeg}>
              <InUse label="Found" />
            </span>
          ) : (
            media && (
              <button
                type="button"
                className="btn"
                onClick={() =>
                  mediaSupport(true)
                    .then(setMedia)
                    .catch(() => {})
                }
              >
                Check again
              </button>
            )
          )}
        </div>
      </div>

      <h2 className="h2">Storage</h2>
      <div className="card" data-setting="Index size">
        <Icon name="tray" size={20} className="k-other kc" />
        <span className="grow">
          <span className="t">Index size</span>
          <span className="s num">
            The index uses {formatBytes(stats?.indexBytes ?? 0)}
            {modelBytes ? ` and models use ${formatBytes(modelBytes)}` : ""}. Smaller is faster and a little less accurate.
          </span>
        </span>
        <ComboBox
          label="Index size"
          value={config.dimensions}
          options={DIMENSIONS}
          onChange={(v) => apply({ ...config, dimensions: v }, true)}
        />
      </div>
    </>
  );
}
