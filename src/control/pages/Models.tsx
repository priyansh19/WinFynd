import { useCallback, useEffect, useState } from "react";
import {
  downloadSpeechModel,
  formatBytes,
  mediaSupport,
  getConfig,
  listModels,
  pullModel,
  setConfig,
  type EngineConfig,
  type InstalledModel,
  type MediaSupport,
  type PullProgress,
  type SpeechProgress,
} from "../../lib/engine";
import { Icon } from "../../components/Icon";
import { InfoBar } from "../../components/InfoBar";
import { ProgressBar } from "../../components/Progress";
import { SettingsCard } from "../../components/SettingsCard";
import { ComboBox, Toggle } from "../../components/Toggle";
import { confirmNative } from "../../lib/native";
import { listen } from "../../lib/tauri";

// EmbeddingGemma 2 sizes available in Ollama. Only the vision-capable ones
// can embed photos; the others index images by file name.
const EMBED_TAGS = [
  { tag: "embeddinggemma-2", label: "EmbeddingGemma 2 · 740M", note: "Text and images · 1.3 GB", images: true },
  { tag: "embeddinggemma-2:440m", label: "EmbeddingGemma 2 · 440M", note: "Text and images · 0.7 GB", images: true },
  { tag: "embeddinggemma-2:270m", label: "EmbeddingGemma 2 · 270M", note: "Text only · 0.3 GB", images: false },
];

const DIMENSIONS = [
  { value: 768, label: "768 · best quality" },
  { value: 512, label: "512 · balanced" },
  { value: 256, label: "256 · smallest for images" },
] as const;

const installedHas = (installed: InstalledModel[], name: string) =>
  installed.some((m) => m.name === name || m.name === `${name}:latest`);

export function ModelsPage() {
  const [config, setLocal] = useState<EngineConfig | null>(null);
  const [installed, setInstalled] = useState<InstalledModel[] | null>(null);
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [pull, setPull] = useState<PullProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaSupport | null>(null);
  const [speechPull, setSpeechPull] = useState<SpeechProgress | null>(null);

  const refresh = useCallback(() => {
    listModels().then((m) => {
      setInstalled(m.installed);
      setOllamaError(m.error);
    });
  }, []);

  useEffect(() => {
    getConfig().then(setLocal);
    refresh();
    mediaSupport().then(setMedia);
    const off = listen<PullProgress>("models://pull", (p) => {
      setPull(p.done && !p.error ? null : p);
      if (p.done) refresh();
    });
    const offSpeech = listen<SpeechProgress>("models://speech", (p) => {
      setSpeechPull(p.done && !p.error ? null : p);
      if (p.done) {
        mediaSupport().then(setMedia);
        getConfig().then(setLocal);
      }
    });
    return () => {
      off.then((f) => f());
      offSpeech.then((f) => f());
    };
  }, [refresh]);

  if (!config) return null;

  const save = async (next: EngineConfig, confirmRebuild = false) => {
    if (
      confirmRebuild &&
      !(await confirmNative(
        "Changing this setting re-indexes all your files. Search keeps working while it runs, but results may be incomplete until it finishes.",
        "Re-index your files?",
        "Re-index",
      ))
    )
      return;
    try {
      setLocal(await setConfig(next));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const download = async (model: string) => {
    setPull({ model, status: "starting", completed: 0, total: 0, done: false, error: null });
    try {
      await pullModel(model);
    } catch (e) {
      setPull(null);
      setError(String(e));
    }
  };

  const downloadSpeech = async (id: string) => {
    setSpeechPull({ id, completed: 0, total: 0, done: false, error: null });
    try {
      await downloadSpeechModel(id);
    } catch (e) {
      setSpeechPull(null);
      setError(String(e));
    }
  };

  const chatModels = (installed ?? []).filter((m) => !m.name.includes("embed"));
  const imagesSupported = !!EMBED_TAGS.find((m) => m.tag === config.embedModel)?.images;

  return (
    <div className="cc-page-inner">
      <h1 className="cc-title">Models</h1>
      <p className="cc-lead">Every model runs on this PC. Nothing you search, say or index is sent anywhere.</p>

      {ollamaError && (
        <InfoBar
          severity="error"
          title="Ollama isn't running"
          action={
            <button type="button" className="btn" onClick={refresh}>
              Check again
            </button>
          }
        >
          Install Ollama from ollama.com and start it. Until then WinFynd searches exact words and file names.
        </InfoBar>
      )}

      <h2 className="cc-section">Embedding model</h2>
      <p className="cc-section-lead">
        EmbeddingGemma 2 places text and images in one space, so a typed description finds matching photos as well as documents.
      </p>
      <div className="cc-stack">
        {EMBED_TAGS.map((m) => {
          const active = config.embedModel === m.tag;
          const have = installed ? installedHas(installed, m.tag) : false;
          const pulling = pull && pull.model === m.tag && !pull.done;
          return (
            <SettingsCard key={m.tag} icon={m.images ? "imageSearch" : "document"} header={m.label} description={m.note}>
              {pulling ? (
                <Progress label={`Downloading ${m.label}`} completed={pull.completed} total={pull.total} status={pull.status} />
              ) : (
                <ModelState active={active && have} have={have} />
              )}
              {!have ? (
                <button
                  type="button"
                  className="btn btn-accent model-action"
                  disabled={!!ollamaError || !!pulling}
                  onClick={() => download(m.tag)}
                >
                  Download
                </button>
              ) : (
                !active && (
                  <button
                    type="button"
                    className="btn model-action"
                    onClick={() => save({ ...config, embedModel: m.tag, indexImages: m.images && config.indexImages }, true)}
                  >
                    Use
                  </button>
                )
              )}
            </SettingsCard>
          );
        })}
        {pull?.error && <p className="cc-error">Download failed: {pull.error}</p>}
        <SettingsCard icon="cube" header="Vector size" description="Smaller vectors use less memory and disk, with a little less accuracy.">
          <ComboBox
            label="Vector size"
            value={config.dimensions}
            options={DIMENSIONS.map((d) => ({ value: d.value, label: d.label }))}
            onChange={(v) => save({ ...config, dimensions: v as EngineConfig["dimensions"] }, true)}
          />
        </SettingsCard>
        <SettingsCard
          icon="image"
          header="Understand photos"
          description={
            imagesSupported
              ? "Embed what's in your images. Off means photos are found by name only."
              : "The model in use reads text only, so photos are found by name."
          }
        >
          <Toggle
            label="Understand photos"
            checked={config.indexImages && imagesSupported}
            disabled={!imagesSupported}
            onChange={(v) => save({ ...config, indexImages: v }, true)}
          />
        </SettingsCard>
      </div>

      <h2 className="cc-section">Audio and video</h2>
      <p className="cc-section-lead">
        Whisper turns what's said in recordings and videos into searchable text, and video frames are embedded like photos, so
        results open at the moment that matches.
      </p>
      <div className="cc-stack">
        {media?.speechModels.map((m) => {
          const active = config.speechModel === m.id && m.installed;
          const pulling = speechPull && speechPull.id === m.id && !speechPull.done;
          return (
            <SettingsCard key={m.id} icon="speech" header={m.label} description={`${m.note} · ${m.sizeMb} MB`}>
              {pulling ? (
                <Progress label={`Downloading ${m.label}`} completed={speechPull.completed} total={speechPull.total} status="Starting" />
              ) : (
                <ModelState active={active} have={m.installed} />
              )}
              {!m.installed ? (
                <button
                  type="button"
                  className="btn btn-accent model-action"
                  disabled={!!speechPull && !speechPull.done}
                  onClick={() => downloadSpeech(m.id)}
                >
                  Download
                </button>
              ) : (
                <button type="button" className="btn model-action" onClick={() => save({ ...config, speechModel: active ? "" : m.id })}>
                  {active ? "Turn off" : "Use"}
                </button>
              )}
            </SettingsCard>
          );
        })}
        {speechPull?.error && <p className="cc-error">Download failed: {speechPull.error}</p>}
        <SettingsCard
          icon="filmstrip"
          header="Search what's shown in videos"
          description={
            media?.ffmpeg ? (
              `Uses FFmpeg (${media.ffmpeg}) to sample frames.`
            ) : (
              <>
                Needs FFmpeg. Install it with <code>winget install Gyan.FFmpeg</code>, then check again.
              </>
            )
          }
        >
          {!media?.ffmpeg && (
            <button type="button" className="btn" onClick={() => mediaSupport(true).then(setMedia)}>
              Check again
            </button>
          )}
          <Toggle
            label="Search what's shown in videos"
            checked={config.indexVideoFrames && !!media?.ffmpeg && config.indexImages}
            disabled={!media?.ffmpeg || !config.indexImages}
            onChange={(v) => save({ ...config, indexVideoFrames: v })}
          />
        </SettingsCard>
      </div>

      <h2 className="cc-section">Answers</h2>
      <div className="cc-stack">
        <SettingsCard
          icon="ask"
          header="Model for Ask"
          description="Any chat model you've pulled in Ollama. It only sees the passages WinFynd finds for your question."
        >
          <ComboBox
            label="Model for Ask"
            value={config.chatModel}
            options={[
              { value: "", label: "Automatic (first installed)" },
              ...chatModels.map((m) => ({ value: m.name, label: `${m.name} · ${formatBytes(m.size)}` })),
            ]}
            onChange={(v) => save({ ...config, chatModel: v })}
          />
        </SettingsCard>
      </div>
      {error && <p className="cc-error">{error}</p>}
    </div>
  );
}

function ModelState({ active, have }: { active: boolean; have: boolean }) {
  return (
    <span className={`model-state ${active ? "is-active" : ""}`}>
      {active && <Icon name="success" size={16} />}
      {active ? "In use" : have ? "Downloaded" : "Not downloaded"}
    </span>
  );
}

function Progress({ label, completed, total, status }: { label: string; completed: number; total: number; status: string }) {
  return (
    <div className="pull-progress">
      <ProgressBar label={label} value={total ? (completed / total) * 100 : undefined} />
      <span>{total ? `${formatBytes(completed)} of ${formatBytes(total)}` : status}</span>
    </div>
  );
}
