import { useCallback, useEffect, useRef, useState } from "react";
import { HotkeyRecorder } from "../../components/HotkeyRecorder";
import { Icon } from "../../components/Icon";
import { KeyCombo } from "../../components/Keycap";
import { ComboBox } from "../../components/Toggle";
import { getHotkeys, setHotkey, setVoiceOptions, type HotkeyAction, type HotkeyConfig, type VoiceMode } from "../../lib/hotkeys";

const ROWS: { id: HotkeyAction; title: string; sub: (mode: VoiceMode) => string }[] = [
  { id: "launcher", title: "Open search", sub: () => "Type to find files, photos and recordings" },
  {
    id: "voice",
    title: "Talk to search",
    sub: (mode) => (mode === "hold" ? "Hold the keys, speak, then let go" : "Press the keys, speak, then press them again"),
  },
  { id: "ask", title: "Ask a question", sub: () => "Opens search in Ask mode" },
  { id: "selection", title: "Search selected text", sub: () => "Searches whatever text is selected in the app you're in" },
];

const MIC_KEY = "wf.mic";
const readMic = () => {
  try {
    return localStorage.getItem(MIC_KEY) ?? "";
  } catch {
    return "";
  }
};

/** The microphones Windows offers; names appear once the microphone has been allowed. */
function useMicrophones() {
  const [mics, setMics] = useState<{ id: string; label: string }[]>([]);
  const refresh = useCallback(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((all) =>
        setMics(
          all
            .filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications")
            .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` })),
        ),
      )
      .catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", refresh);
  }, [refresh]);
  return { mics, refresh };
}

const BARS = 16;
const SHAPE = [0.5, 0.75, 0.6, 1, 0.7, 0.9, 0.55, 0.8, 1, 0.65, 0.85, 0.5, 0.75, 0.95, 0.6, 0.7];

/** "Say something. The bars should move." Listens for 15 seconds, only after Test is pressed. */
function MicTest({ device, onAllowed }: { device: string; onAllowed: () => void }) {
  const [level, setLevel] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const stop = useRef<() => void>(() => {});

  const start = async () => {
    setFailed(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: device ? { deviceId: { exact: device } } : true });
      onAllowed();
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let frame = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 6));
        frame = requestAnimationFrame(tick);
      };
      tick();
      const timer = window.setTimeout(() => stop.current(), 15000);
      stop.current = () => {
        cancelAnimationFrame(frame);
        clearTimeout(timer);
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
        setLevel(null);
      };
    } catch {
      setFailed(true);
    }
  };

  useEffect(() => () => stop.current(), []);
  const now = performance.now();
  return (
    <>
      <div className="eq mic-eq" aria-hidden="true">
        {SHAPE.slice(0, BARS).map((s, i) => (
          <i
            key={i}
            style={
              level === null
                ? { transform: `scaleY(${s * 0.6})`, opacity: 0.45 }
                : { transform: `scaleY(${Math.max(0.14, Math.min(1, level * s * (0.8 + 0.2 * Math.sin(now / 110 + i * 1.7))))})` }
            }
          />
        ))}
      </div>
      {failed && <span className="small" style={{ color: "var(--danger)" }}>No microphone</span>}
      <button type="button" className="btn" onClick={() => (level === null ? start() : stop.current())}>
        {level === null ? "Test" : "Stop"}
      </button>
    </>
  );
}

export function ShortcutsPage() {
  const [config, setConfig] = useState<HotkeyConfig | null>(null);
  const [unavailable, setUnavailable] = useState<HotkeyAction[]>([]);
  const [recording, setRecording] = useState<HotkeyAction | null>(null);
  const [mic, setMic] = useState(readMic);
  const { mics, refresh: refreshMics } = useMicrophones();

  useEffect(() => {
    getHotkeys()
      .then((s) => {
        setConfig(s.config);
        setUnavailable(s.unavailable);
      })
      .catch(() => {});
  }, []);

  const cancel = useCallback(() => setRecording(null), []);
  if (!config) return null;

  const save = async (action: HotkeyAction, accelerator: string) => {
    setConfig(await setHotkey(action, accelerator));
    setUnavailable((u) => u.filter((a) => a !== action));
    setRecording(null);
  };

  const pickMic = (id: string) => {
    setMic(id);
    try {
      if (id) localStorage.setItem(MIC_KEY, id);
      else localStorage.removeItem(MIC_KEY);
    } catch {
      // Not remembered; the default microphone is used.
    }
  };

  return (
    <>
      <h1 className="h1">Shortcuts &amp; voice</h1>
      <p className="lede">Shortcuts work from any app. Pick keys no other app uses.</p>
      <div className="stack">
        {ROWS.map((r) => (
          <div key={r.id} className={`card${recording === r.id ? " recording" : ""}`} data-setting={r.title}>
            <Icon name="keyboard" size={20} className="k-code kc" />
            <span className="grow">
              <span className="t">{r.title}</span>
              {unavailable.includes(r.id) ? (
                <span className="s" style={{ color: "var(--danger)" }}>
                  Another app is using these keys. Pick different ones.
                </span>
              ) : (
                <span className="s">{r.sub(config.voiceMode)}</span>
              )}
            </span>
            {recording === r.id ? (
              <HotkeyRecorder onSave={(acc) => save(r.id, acc)} onCancel={cancel} />
            ) : (
              <>
                <KeyCombo accelerator={config[r.id]} />
                <button type="button" className="btn" disabled={recording !== null} onClick={() => setRecording(r.id)}>
                  Change
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      <h2 className="h2">Voice</h2>
      <div className="stack k-audio">
        <div className="card" data-setting="Microphone">
          <Icon name="mic" size={20} className="k-audio kc" />
          <span className="grow">
            <span className="t">Microphone</span>
            <span className="s">Used only while you hold the talk shortcut</span>
          </span>
          <ComboBox
            label="Microphone"
            width={280}
            value={mics.some((m) => m.id === mic) ? mic : ""}
            options={[{ value: "", label: "Windows default" }, ...mics.map((m) => ({ value: m.id, label: m.label }))]}
            onChange={pickMic}
          />
        </div>
        <div className="card">
          <Icon name="wave" size={20} className="k-audio kc" />
          <span className="grow">
            <span className="t">Test your microphone</span>
            <span className="s">Say something. The bars should move.</span>
          </span>
          <MicTest device={mics.some((m) => m.id === mic) ? mic : ""} onAllowed={refreshMics} />
        </div>
        <div className="card" style={{ alignItems: "flex-start" }} data-setting="How talking works">
          <Icon name="bolt" size={20} className="k-audio kc" />
          <span className="grow">
            <span className="t">How talking works</span>
            <span className="radios" role="radiogroup" aria-label="How talking works">
              {(
                [
                  ["hold", "Hold the shortcut while you speak"],
                  ["toggle", "Press once to start, press again to stop"],
                ] as const
              ).map(([mode, label]) => (
                <label key={mode} className="radio-row">
                  <input
                    type="radio"
                    className="radio"
                    name="voice-mode"
                    checked={config.voiceMode === mode}
                    onChange={() => setVoiceOptions(mode, config.autoSubmit).then(setConfig)}
                  />
                  {label}
                </label>
              ))}
            </span>
          </span>
        </div>
      </div>
    </>
  );
}
