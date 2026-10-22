import { useCallback, useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Progress";
import { listModels, mediaSupport, type InstalledModel, type MediaSupport } from "../../lib/engine";
import { openOllamaDownload, setupDoneBefore } from "../../lib/onboarding";
import { ollamaInfo } from "../../lib/stats";
import { NavButtons, Page, type StepProps } from "../Onboarding";

// The same sizes as Settings > Models. WinFynd runs one text model, with
// the photo encoders as an extra download.
const EMBED_BUILTIN = [
  { tag: "embeddinggemma-2", title: "Text and photos", sub: "Finds photos by what's in them. Best on a PC with 8 GB of memory or more.", size: "865 MB", images: true, recommended: true },
  { tag: "embeddinggemma-2:270m", title: "Text only", sub: "Smaller and lighter. Photos are found by name.", size: "310 MB", images: false },
];
// The three sizes Ollama offers, when Settings > Models is set to run it there.
const EMBED_OLLAMA = [
  { tag: "embeddinggemma-2", title: "Most accurate", sub: "Text and photos. Best results on a PC with 16 GB of memory.", size: "740M · 1.3 GB", images: true, recommended: true },
  { tag: "embeddinggemma-2:440m", title: "Balanced", sub: "Text and photos. A little faster, slightly less precise.", size: "440M · 0.7 GB", images: true },
  { tag: "embeddinggemma-2:270m", title: "Smallest", sub: "Text only. Photos are found by name.", size: "270M · 0.3 GB", images: false },
];
const SPEECH = "small";

const has = (installed: InstalledModel[], name: string) => installed.some((m) => m.name === name || m.name === `${name}:latest`);

export function ModelStep({ config, save, next, back, pulls, startPull, speech, startSpeech }: StepProps) {
  const builtin = config.embedBackend !== "ollama";
  const EMBED = builtin ? EMBED_BUILTIN : EMBED_OLLAMA;
  /** undefined while looking, null when Ollama isn't running. */
  const [installed, setInstalled] = useState<InstalledModel[] | null | undefined>(undefined);
  const [version, setVersion] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaSupport | null>(null);
  const [pick, setPick] = useState(EMBED.some((e) => e.tag === config.embedModel) ? config.embedModel : EMBED[0].tag);
  const [withSpeech, setWithSpeech] = useState(config.speechModel !== "" || !setupDoneBefore());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(() => {
    listModels()
      .then((m) => setInstalled(m.installed))
      .catch(() => setInstalled(null));
    ollamaInfo()
      .then((i) => setVersion(i.version))
      .catch(() => {});
  }, []);

  useEffect(() => {
    check();
    mediaSupport()
      .then(setMedia)
      .catch(() => {});
  }, [check]);

  // While Ollama is missing, keep looking so the page updates by itself once it runs.
  useEffect(() => {
    if (builtin || installed !== null) return;
    const t = window.setInterval(check, 3000);
    return () => window.clearInterval(t);
  }, [builtin, installed, check]);

  const whisper = media?.speechModels.find((m) => m.id === SPEECH);

  const go = async () => {
    setSaving(true);
    setError(null);
    try {
      const m = EMBED.find((e) => e.tag === pick)!;
      const before = [...EMBED_BUILTIN, ...EMBED_OLLAMA].find((e) => e.tag === config.embedModel);
      // Photos follow the model: off for the text-only one, back on when moving up from it.
      const indexImages = m.images && (config.indexImages || !before?.images);
      let speechModel = config.speechModel;
      if (!withSpeech) speechModel = "";
      else if (!speechModel && whisper?.installed) speechModel = SPEECH;
      if (pick !== config.embedModel || indexImages !== config.indexImages || speechModel !== config.speechModel) {
        await save({ ...config, embedModel: pick, indexImages, speechModel });
      }
      // Downloads carry on through the next steps; warm-up shows them.
      const pull = pulls[pick];
      if (installed && !has(installed, pick) && !(pull && !pull.done)) startPull(pick);
      if (!withSpeech) startSpeech(null);
      else if (!speechModel && whisper && !(speech && !speech.done)) startSpeech(SPEECH);
      next();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <Page footer={<NavButtons back={back} next={go} disabled={saving} />}>
      <h1 className="setup-title">Download the search model</h1>
      <p className="setup-lede">EmbeddingGemma 2 reads your text and photos so you can search by what they mean. It downloads once and then runs offline.</p>

      {builtin && (
        <div className="infobar">
          <Icon name="check" size={16} strokeWidth={2} />
          <span>
            <strong>Runs inside WinFynd</strong> <span className="muted">· nothing else to install</span>
          </span>
        </div>
      )}
      {!builtin && installed === undefined && (
        <div className="infobar info">
          <Spinner label="Looking for Ollama" />
          <span>Looking for Ollama on this PC…</span>
        </div>
      )}
      {!builtin && installed && (
        <div className="infobar">
          <Icon name="check" size={16} strokeWidth={2} />
          <span>
            <strong>Ollama found</strong> <span className="muted">· {version ? `version ${version}, ` : ""}running on this PC</span>
          </span>
        </div>
      )}
      {!builtin && installed === null && (
        <div className="infobar warning" aria-live="polite">
          <Icon name="warning" size={16} />
          <span className="grow">
            <strong>Ollama isn't running</strong>{" "}
            <span className="muted">· WinFynd runs the model with it. Install it and this page carries on by itself.</span>
          </span>
          <button type="button" className="btn" onClick={() => openOllamaDownload().catch((e) => setError(String(e)))}>
            Get Ollama
          </button>
        </div>
      )}
      {error && (
        <div className="infobar error" role="alert">
          <Icon name="error" size={16} />
          <span className="grow selectable">{error}</span>
        </div>
      )}

      <div className="model-picks" role="radiogroup" aria-label="Search model">
        {EMBED.map((m) => {
          const on = pick === m.tag;
          const here = installed ? has(installed, m.tag) : false;
          return (
            <label key={m.tag} className={`card model-pick${on ? " on" : ""}`}>
              <span className="model-pick-head">
                <input type="radio" className="radio" name="embed" checked={on} onChange={() => setPick(m.tag)} />
                <span className="t">{m.title}</span>
              </span>
              <span className="s model-pick-sub">{m.sub}</span>
              <span className="model-pick-foot">
                <span className="small muted num">{here ? `${m.size.split(" · ")[0]} · downloaded` : m.size}</span>
                <span className="push" />
                {m.recommended && <span className="chip">Recommended</span>}
              </span>
            </label>
          );
        })}
      </div>

      <label className="card k-audio speech-pick">
        <input type="checkbox" className="check" checked={withSpeech} onChange={(e) => setWithSpeech(e.target.checked)} />
        <Icon name="wave" size={20} className="k-audio kc" />
        <span className="grow">
          <span className="t">Also search speech in recordings and videos</span>
          <span className="s">{whisper?.installed ? "Uses Whisper Small, already on this PC" : `Adds Whisper Small · ${whisper?.sizeMb ?? 488} MB`}</span>
        </span>
      </label>
    </Page>
  );
}
