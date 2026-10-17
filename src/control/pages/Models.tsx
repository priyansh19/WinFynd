import { useState } from "react";

type Status = "active" | "ready" | "missing" | "downloading";

interface ModelSlot {
  tag: string;
  tint: string;
  role: string;
  name: string;
  size: string;
  status: Status;
}

// The model catalogue the app will ship with. Download and load are not
// wired to the backend yet; the page holds state locally.
const INITIAL: ModelSlot[] = [
  { tag: "TXT", tint: "#8db8ff", role: "Text embeddings", name: "nomic-embed-text v1.5", size: "274 MB", status: "active" },
  { tag: "IMG", tint: "#8fe0aa", role: "Images and video frames", name: "SigLIP base patch16", size: "813 MB", status: "active" },
  { tag: "OCR", tint: "#f0a040", role: "Text in images and scans", name: "Windows OCR (built in)", size: "0 MB", status: "active" },
  { tag: "STT", tint: "#c79bff", role: "Voice search", name: "Whisper small (English)", size: "466 MB", status: "ready" },
  { tag: "LLM", tint: "#ff9e7a", role: "Answers and agent actions", name: "Qwen2.5 3B Instruct (Q4)", size: "1.9 GB", status: "active" },
  { tag: "AUD", tint: "#c79bff", role: "Transcribe recordings and videos", name: "Whisper medium", size: "1.5 GB", status: "missing" },
];

const STATUS_LABEL: Record<Status, string> = {
  active: "Active",
  ready: "Ready",
  missing: "Not installed",
  downloading: "Downloading",
};

export function ModelsPage() {
  const [models, setModels] = useState(INITIAL);
  const [device, setDevice] = useState("gpu");

  const download = (tag: string) =>
    setModels((ms) => ms.map((m) => (m.tag === tag ? { ...m, status: "downloading" } : m)));

  return (
    <>
      <header className="cc-header cc-header-row">
        <div>
          <h1>On-device models</h1>
          <p>Every model runs locally. Nothing you search, say or index is sent anywhere.</p>
        </div>
        <label className="field">
          Run models on
          <select value={device} onChange={(e) => setDevice(e.target.value)}>
            <option value="gpu">GPU</option>
            <option value="npu">NPU</option>
            <option value="cpu">CPU only</option>
          </select>
        </label>
      </header>

      <div className="card list">
        {models.map((m) => (
          <div key={m.tag} className="list-row">
            <div className="model-tag" style={{ color: m.tint }}>
              {m.tag}
            </div>
            <div className="list-text">
              <span className="cc-muted">{m.role}</span>
              <span className="list-title">{m.name}</span>
            </div>
            <span className="model-size">{m.size}</span>
            <span className={`pill pill-${m.status}`}>{STATUS_LABEL[m.status]}</span>
            {m.status === "missing" ? (
              <button type="button" className="btn btn-primary model-action" onClick={() => download(m.tag)}>
                Download
              </button>
            ) : (
              <button type="button" className="btn model-action" disabled={m.status === "downloading"}>
                Change
              </button>
            )}
          </div>
        ))}
      </div>

      <p className="cc-muted">Models download once from their public source, then run fully offline.</p>
    </>
  );
}
