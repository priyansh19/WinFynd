import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { KeyCombo } from "../components/Keycap";
import type { VoiceMode } from "../lib/hotkeys";
import { transcribeVoice } from "../lib/search";

/** Whisper listens at 16 kHz, mono. */
const RATE = 16000;
/** A press longer than this stops by itself. */
const MAX_SECONDS = 30;
/** How often the words heard so far are refreshed while talking. */
const INTERIM_MS = 1800;

export type VoiceState = "off" | "listening" | "transcribing";

function join(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Resample to 16 kHz with the browser's own filter, so Whisper hears it cleanly. */
async function to16k(samples: Float32Array, rate: number): Promise<Float32Array> {
  if (rate === RATE || !samples.length) return samples;
  const ctx = new OfflineAudioContext(1, Math.ceil((samples.length * RATE) / rate), RATE);
  const buffer = ctx.createBuffer(1, samples.length, rate);
  buffer.getChannelData(0).set(samples);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  return (await ctx.startRendering()).getChannelData(0);
}

/** The microphone picked in Settings, if any. */
function chosenMic(): string | undefined {
  try {
    return localStorage.getItem("wf.mic") || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Push to talk. Records the microphone while the voice keys are held, shows
 * the words as Whisper hears them, and on release hands the final text back.
 * Speech is turned into text by the engine on this PC; nothing leaves it.
 */
export function useVoice({ onDone, onError }: { onDone: (text: string) => void; onError: (message: string) => void }) {
  const [state, setState] = useState<VoiceState>("off");
  const [level, setLevel] = useState<number | null>(null);
  const [heard, setHeard] = useState("");
  const capture = useRef<{ stream: MediaStream; ctx: AudioContext; chunks: Float32Array[] } | null>(null);
  const live = useRef(false);
  const stopWanted = useRef(false);
  const interim = useRef<{ timer: number; busy: boolean }>({ timer: 0, busy: false });
  const limit = useRef(0);
  const done = useRef(onDone);
  const failed = useRef(onError);
  done.current = onDone;
  failed.current = onError;

  const close = useCallback(() => {
    clearInterval(interim.current.timer);
    clearTimeout(limit.current);
    const c = capture.current;
    capture.current = null;
    c?.stream.getTracks().forEach((t) => t.stop());
    c?.ctx.close().catch(() => {});
    setLevel(null);
    return c;
  }, []);

  const stop = useCallback(async () => {
    if (!live.current) return;
    if (!capture.current) {
      // Released before the microphone opened: stop as soon as it does.
      stopWanted.current = true;
      return;
    }
    live.current = false;
    const c = close();
    if (!c) return;
    setState("transcribing");
    try {
      const samples = await to16k(join(c.chunks), c.ctx.sampleRate);
      const text = samples.length > RATE / 4 ? await transcribeVoice(samples) : "";
      setState("off");
      setHeard("");
      done.current(text.trim());
    } catch (e) {
      setState("off");
      setHeard("");
      failed.current(String(e));
    }
  }, [close]);

  const start = useCallback(async () => {
    if (live.current) return;
    live.current = true;
    stopWanted.current = false;
    setHeard("");
    setState("listening");
    try {
      const mic = chosenMic();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: mic ? { ideal: mic } : undefined, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      if (!live.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const ctx = new AudioContext();
      const chunks: Float32Array[] = [];
      const source = ctx.createMediaStreamSource(stream);
      // ScriptProcessor is old but runs everywhere WebView2 does, with no worklet file to ship.
      const tap = ctx.createScriptProcessor(4096, 1, 1);
      tap.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(data));
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 6));
      };
      source.connect(tap);
      tap.connect(ctx.destination);
      capture.current = { stream, ctx, chunks };
      limit.current = window.setTimeout(() => stop(), MAX_SECONDS * 1000);
      interim.current.timer = window.setInterval(async () => {
        const c = capture.current;
        if (!c || interim.current.busy || c.chunks.length < 4) return;
        interim.current.busy = true;
        try {
          const text = await transcribeVoice(await to16k(join(c.chunks), c.ctx.sampleRate));
          if (live.current) setHeard(text.trim());
        } catch {
          // The final pass reports any problem.
        } finally {
          interim.current.busy = false;
        }
      }, INTERIM_MS);
      if (stopWanted.current) stop();
    } catch {
      live.current = false;
      close();
      setState("off");
      failed.current("Windows didn't give WinFynd the microphone. Turn it on in Settings, Privacy & security, Microphone.");
    }
  }, [close, stop]);

  const cancel = useCallback(() => {
    live.current = false;
    close();
    setHeard("");
    setState("off");
  }, [close]);

  useEffect(() => cancel, [cancel]);

  return useMemo(() => ({ state, level, heard, start, stop, cancel }), [state, level, heard, start, stop, cancel]);
}

/** How tall each bar of the meter stands at full voice. */
const SHAPE = [0.55, 0.8, 0.65, 1, 0.75, 0.9, 0.6, 0.85, 1, 0.7, 0.8, 0.5];
const DELAYS = [0, 320, 140, 560, 260, 700, 80, 420, 610, 200, 350, 90];

/**
 * The row under the search box while talking: a level meter, how to finish,
 * and the promise that speech stays here. Before the microphone reports a
 * level, the bars sway on their own.
 */
export function VoiceBar({
  state,
  level,
  mode,
  accelerator,
  byClick,
}: {
  state: VoiceState;
  level: number | null;
  mode: VoiceMode;
  accelerator: string;
  byClick: boolean;
}) {
  const now = performance.now();
  return (
    <div className="voicebar" role="status">
      <div className={`eq${level === null || state !== "listening" ? " idle" : ""}`} aria-hidden="true">
        {SHAPE.map((s, i) => (
          <i
            key={i}
            style={
              level === null || state !== "listening"
                ? { animationDelay: `-${DELAYS[i]}ms` }
                : { transform: `scaleY(${Math.max(0.14, Math.min(1, level * s * (0.8 + 0.2 * Math.sin(now / 110 + i * 1.7))))})` }
            }
          />
        ))}
      </div>
      {state === "transcribing" ? (
        <span className="voicebar-hint">Turning what you said into words on this PC…</span>
      ) : byClick ? (
        <span className="voicebar-hint">
          Listening. Press <kbd className="kbd">Enter</kbd> or click the mic to search.
        </span>
      ) : mode === "hold" ? (
        <span className="voicebar-hint">
          Listening. Release <KeyCombo accelerator={accelerator} /> to search.
        </span>
      ) : (
        <span className="voicebar-hint">
          Listening. Press <KeyCombo accelerator={accelerator} /> again to search.
        </span>
      )}
      <span className="voicebar-private">
        <Icon name="lock" size={14} /> Speech stays on this PC
      </span>
    </div>
  );
}
