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
    if (confirmRebuild && !window.confirm("Changing this re-indexes all your files with the new setting. Continue?")) return;
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

  return (
    <>
      <header className="cc-header">
        <h1>On-device models</h1>
        <p>Every model runs on this PC. Nothing you search, say or index is sent anywhere.</p>
      </header>

      {ollamaError && (
        <div className="card notice" role="alert">
          <div className="list-text">
            <span className="list-title">Ollama isn't running</span>
            <span className="cc-muted">
              Install Ollama from ollama.com and start it, then come back here. Until then WinFynd searches exact words and
              file names.
            </span>
          </div>
          <button type="button" className="btn" onClick={refresh}>
            Check again
          </button>
        </div>
      )}

      <h2 className="cc-subhead">Embedding model</h2>
      <p className="cc-muted section-lead">
        EmbeddingGemma 2 places text and images in one space, so a typed description finds matching photos as well as documents.
      </p>
      <div className="card list">
        {EMBED_TAGS.map((m) => {
          const active = config.embedModel === m.tag;
          const have = installed ? installedHas(installed, m.tag) : false;
          const pulling = pull && pull.model === m.tag && !pull.done;
          return (
            <div key={m.tag} className="list-row">
              <div className="model-tag" style={{ color: m.images ? "#8fe0aa" : "#8db8ff" }}>
                {m.images ? "IMG" : "TXT"}
              </div>
              <div className="list-text">
                <span className="list-title">{m.label}</span>
                <span className="cc-muted">{m.note}</span>
              </div>
              {pulling ? (
                <div className="pull-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100}
                  aria-valuenow={pull.total ? Math.round((pull.completed / pull.total) * 100) : 0}>
                  <div className="meter">
                    <div className="meter-fill meter-accent" style={{ width: `${pull.total ? (pull.completed / pull.total) * 100 : 3}%` }} />
                  </div>
                  <span className="cc-muted">
                    {pull.total ? `${formatBytes(pull.completed)} of ${formatBytes(pull.total)}` : pull.status}
                  </span>
                </div>
              ) : (
                <span className={`pill ${active && have ? "pill-active" : have ? "pill-ready" : "pill-missing"}`}>
                  {active && have ? "In use" : have ? "Downloaded" : "Not downloaded"}
                </span>
              )}
              {!have ? (
                <button type="button" className="btn btn-primary model-action" disabled={!!ollamaError || !!pulling} onClick={() => download(m.tag)}>
                  Download
                </button>
              ) : (
                <button
                  type="button"
                  className="btn model-action"
                  disabled={active}
                  onClick={() => save({ ...config, embedModel: m.tag, indexImages: m.images && config.indexImages }, true)}
                >
                  {active ? "In use" : "Use"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {pull?.error && <span className="text-danger">Download failed: {pull.error}</span>}

      <div className="card list">
        <div className="list-row">
          <div className="list-text">
            <span className="list-title">Vector size</span>
            <span className="cc-muted">Smaller vectors use less memory and disk, with a little less accuracy.</span>
          </div>
          <label className="field">
            <span className="sr-only">Vector size</span>
            <select
              value={config.dimensions}
              onChange={(e) => save({ ...config, dimensions: Number(e.target.value) as EngineConfig["dimensions"] }, true)}
            >
              {DIMENSIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="list-row">
          <div className="list-text">
            <span className="list-title">Understand photos</span>
            <span className="cc-muted">Embed what's in your images. Off means photos are found by name only.</span>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={config.indexImages}
              disabled={!EMBED_TAGS.find((m) => m.tag === config.embedModel)?.images}
              onChange={(e) => save({ ...config, indexImages: e.target.checked }, true)}
            />
            <span>Index image content</span>
          </label>
        </div>
      </div>

      <h2 className="cc-subhead">Audio and video</h2>
      <p className="cc-muted section-lead">
        Whisper turns what's said in recordings and videos into searchable text, and video frames are embedded like photos,
        so results open at the moment that matches.
      </p>
      <div className="card list">
        {media?.speechModels.map((m) => {
          const active = config.speechModel === m.id && m.installed;
          const pulling = speechPull && speechPull.id === m.id && !speechPull.done;
          return (
            <div key={m.id} className="list-row">
              <div className="model-tag" style={{ color: "#f0c080" }}>
                ASR
              </div>
              <div className="list-text">
                <span className="list-title">{m.label}</span>
                <span className="cc-muted">
                  {m.note} · {m.sizeMb} MB
                </span>
              </div>
              {pulling ? (
                <div className="pull-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100}
                  aria-valuenow={speechPull.total ? Math.round((speechPull.completed / speechPull.total) * 100) : 0}>
                  <div className="meter">
                    <div className="meter-fill meter-accent"
                      style={{ width: `${speechPull.total ? (speechPull.completed / speechPull.total) * 100 : 3}%` }} />
                  </div>
                  <span className="cc-muted">
                    {speechPull.total ? `${formatBytes(speechPull.completed)} of ${formatBytes(speechPull.total)}` : "Starting"}
                  </span>
                </div>
              ) : (
                <span className={`pill ${active ? "pill-active" : m.installed ? "pill-ready" : "pill-missing"}`}>
                  {active ? "In use" : m.installed ? "Downloaded" : "Not downloaded"}
                </span>
              )}
              {!m.installed ? (
                <button type="button" className="btn btn-primary model-action" disabled={!!speechPull && !speechPull.done}
                  onClick={() => downloadSpeech(m.id)}>
                  Download
                </button>
              ) : (
                <button type="button" className="btn model-action" onClick={() => save({ ...config, speechModel: active ? "" : m.id })}>
                  {active ? "Turn off" : "Use"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {speechPull?.error && <span className="text-danger">Download failed: {speechPull.error}</span>}

      <div className="card list">
        <div className="list-row">
          <div className="list-text">
            <span className="list-title">Search what's shown in videos</span>
            <span className="cc-muted">
              {media?.ffmpeg ? (
                `Uses FFmpeg (${media.ffmpeg}) to sample frames.`
              ) : (
                <>
                  Needs FFmpeg. Install it with <code>winget install Gyan.FFmpeg</code>, then press Check again.
                </>
              )}
            </span>
          </div>
          {!media?.ffmpeg && (
            <button type="button" className="btn" onClick={() => mediaSupport(true).then(setMedia)}>
              Check again
            </button>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={config.indexVideoFrames && !!media?.ffmpeg && config.indexImages}
              disabled={!media?.ffmpeg || !config.indexImages}
              onChange={(e) => save({ ...config, indexVideoFrames: e.target.checked })}
            />
            <span>Index video frames</span>
          </label>
        </div>
      </div>

      <h2 className="cc-subhead">Answer model</h2>
      <div className="card list">
        <div className="list-row">
          <div className="list-text">
            <span className="list-title">Model for Ask mode</span>
            <span className="cc-muted">
              Any chat model you've pulled in Ollama. It only sees the passages WinFynd finds for your question.
            </span>
          </div>
          <label className="field">
            <span className="sr-only">Model for Ask mode</span>
            <select value={config.chatModel} onChange={(e) => save({ ...config, chatModel: e.target.value })}>
              <option value="">Automatic (first installed)</option>
              {chatModels.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} · {formatBytes(m.size)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {error && <span className="text-danger">{error}</span>}
    </>
  );
}
