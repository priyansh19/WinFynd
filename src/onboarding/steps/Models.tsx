import { useCallback, useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import {
  downloadSpeechModel,
  listModels,
  mediaSupport,
  setConfig as saveConfig,
  type InstalledModel,
  type MediaSupport,
  type SpeechProgress,
} from "../../lib/engine";
import { openOllamaDownload } from "../../lib/onboarding";
import { listen } from "../../lib/tauri";
import { Check, StepFooter, StepHeader, type StepProps } from "../Onboarding";

// Same sizes as the Models page; the largest is what most PCs should use.
const EMBED_TAGS = [
  { tag: "embeddinggemma-2", label: "Best", size: "1.3 GB", note: "Text and photos. Recommended." },
  { tag: "embeddinggemma-2:440m", label: "Balanced", size: "0.7 GB", note: "Text and photos, for older PCs." },
  { tag: "embeddinggemma-2:270m", label: "Smallest", size: "0.3 GB", note: "Text only. Photos are found by name." },
];

const SPEECH_ID = "small";

const has = (installed: InstalledModel[], name: string) =>
  installed.some((m) => m.name === name || m.name === `${name}:latest`);

const percent = (p: { completed: number; total: number }) => (p.total ? Math.round((p.completed / p.total) * 100) : 0);

export function ModelsStep({ config, setConfig, next, back, pull, startPull }: StepProps) {
  const [installed, setInstalled] = useState<InstalledModel[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [media, setMedia] = useState<MediaSupport | null>(null);
  const [speech, setSpeech] = useState<SpeechProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    () =>
      listModels().then((m) => {
        setInstalled(m.installed);
        setOffline(m.installed === null);
      }),
    [],
  );

  useEffect(() => {
    refresh();
    mediaSupport().then(setMedia);
    const offSpeech = listen<SpeechProgress>("models://speech", (p) => {
      setSpeech(p.done && !p.error ? null : p);
      if (p.error) setError(p.error);
      if (p.done && !p.error) {
        mediaSupport().then(setMedia);
        saveConfig({ ...config, speechModel: p.id }).then(setConfig).catch((e) => setError(String(e)));
      }
    });
    return () => {
      offSpeech.then((f) => f());
    };
    // Subscribe once; `config` is only read for the speech model hand-off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  // A finished download changes what's installed.
  useEffect(() => {
    if (!pull?.done) return;
    if (pull.error) setError(pull.error);
    refresh();
  }, [pull?.done, pull?.error, refresh]);

  // While Ollama is missing, keep checking so the step moves on by itself once it starts.
  useEffect(() => {
    if (!offline) return;
    const t = window.setInterval(refresh, 3000);
    return () => window.clearInterval(t);
  }, [offline, refresh]);

  const choose = async (tag: string) => {
    if (tag === config.embedModel) return;
    try {
      setConfig(await saveConfig({ ...config, embedModel: tag }));
    } catch (e) {
      setError(String(e));
    }
  };

  const download = (model: string) => {
    setError(null);
    startPull(model);
  };

  const downloadSpeech = async () => {
    setError(null);
    if (whisper?.installed) {
      saveConfig({ ...config, speechModel: SPEECH_ID }).then(setConfig).catch((e) => setError(String(e)));
      return;
    }
    setSpeech({ id: SPEECH_ID, completed: 0, total: 0, done: false, error: null });
    try {
      await downloadSpeechModel(SPEECH_ID);
    } catch (e) {
      setSpeech(null);
      setError(String(e));
    }
  };

  const embedReady = installed ? has(installed, config.embedModel) : false;
  const pulling = pull && !pull.done ? pull : null;
  const whisper = media?.speechModels.find((m) => m.id === SPEECH_ID);
  const speechOn = config.speechModel !== "";

  return (
    <>
      <StepHeader
        title="Turn on search by meaning"
        lead="WinFynd uses open models that run on this PC through Ollama, a free app. Nothing is uploaded, ever."
      />

      {installed === null && !offline && <p className="ob-muted">Looking for Ollama on this PC…</p>}

      {offline && (
        <section className="ob-card ob-callout" aria-live="polite">
          <span className="ob-callout-icon">
            <Icon name="download" size={20} />
          </span>
          <span className="ob-row-text">
            <span className="ob-row-title">Install Ollama to continue</span>
            <span className="ob-muted">
              Download it from ollama.com, run the installer, and come back. This page notices when it's running.
            </span>
          </span>
          <div className="ob-callout-actions">
            <button type="button" className="ob-btn ob-btn-accent" onClick={() => openOllamaDownload().catch((e) => setError(String(e)))}>
              Get Ollama
            </button>
            <button type="button" className="ob-btn" onClick={refresh}>
              Check again
            </button>
          </div>
        </section>
      )}

      {installed && (
        <section className="ob-section">
          <h2>Search model</h2>
          <div className="ob-choices" role="radiogroup" aria-label="EmbeddingGemma 2 size">
            {EMBED_TAGS.map((m) => {
              const selected = config.embedModel === m.tag;
              return (
                <button
                  key={m.tag}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className="ob-card ob-choice"
                  disabled={pulling !== null}
                  onClick={() => choose(m.tag)}
                >
                  <span className="ob-choice-head">
                    <span className="ob-radio" aria-hidden="true" />
                    <span className="ob-row-title">{m.label}</span>
                    <span className="ob-muted ob-push">{has(installed, m.tag) ? "Installed" : m.size}</span>
                  </span>
                  <span className="ob-muted">{m.note}</span>
                </button>
              );
            })}
          </div>
          <div className="ob-card ob-row">
            <span className="ob-row-text">
              <span className="ob-row-title">EmbeddingGemma 2</span>
              <span className="ob-muted">
                {embedReady
                  ? "Ready. Search by meaning is on."
                  : pulling
                    ? `Downloading · ${percent(pulling)}%`
                    : "Download once, then it works offline."}
              </span>
              {pulling && <Progress value={percent(pulling)} label="Downloading EmbeddingGemma 2" />}
            </span>
            {embedReady ? (
              <span className="ob-ready">
                <Check /> Ready
              </span>
            ) : (
              <button type="button" className="ob-btn ob-btn-accent" disabled={pulling !== null} onClick={() => download(config.embedModel)}>
                Download
              </button>
            )}
          </div>
        </section>
      )}

      {whisper && (
        <section className="ob-section">
          <h2>Optional</h2>
          <div className="ob-card ob-row">
            <span className="ob-row-text">
              <span className="ob-row-title">Search what's said in recordings and videos</span>
              <span className="ob-muted">
                {speech
                  ? `Downloading Whisper · ${percent(speech)}%`
                  : speechOn
                    ? "On. Recordings are transcribed on this PC."
                    : `Whisper transcribes audio on this PC. ${whisper.sizeMb} MB download.`}
              </span>
              {speech && <Progress value={percent(speech)} label="Downloading Whisper" />}
            </span>
            {speechOn ? (
              <span className="ob-ready">
                <Check /> On
              </span>
            ) : (
              <button type="button" className="ob-btn" disabled={speech !== null} onClick={downloadSpeech}>
                {whisper.installed ? "Turn on" : "Download"}
              </button>
            )}
          </div>
        </section>
      )}

      {error && (
        <p className="ob-error" role="alert">
          {error}
        </p>
      )}

      {!embedReady && (
        <p className="ob-muted ob-footnote">If you skip, WinFynd still finds files by exact words and names. Downloads keep going in the background.</p>
      )}

      <StepFooter back={back}>
        {!embedReady && (
          <button type="button" className="ob-btn ob-btn-subtle" onClick={next}>
            Skip for now
          </button>
        )}
        <button type="button" className="ob-btn ob-btn-accent" disabled={!embedReady} onClick={next}>
          Next
        </button>
      </StepFooter>
    </>
  );
}

function Progress({ value, label }: { value: number; label: string }) {
  return (
    <span className="ob-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <span className="ob-progress-fill" style={{ width: `${Math.max(value, 2)}%` }} />
    </span>
  );
}
