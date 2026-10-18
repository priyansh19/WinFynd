import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keycap } from "../components/Keycap";
import type { VoiceMode } from "../lib/hotkeys";

/**
 * Microphone capture for voice search. It measures the input level for the
 * listening UI; turning speech into text is the on-device Whisper model's job
 * and isn't wired up yet, so transcripts are not produced.
 */
export function useVoice({ onTranscript }: { onTranscript: (text: string, final: boolean) => void }) {
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const stream = useRef<MediaStream | null>(null);
  const frame = useRef<number>(0);
  const transcript = useRef("");

  const stopCapture = useCallback(() => {
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    setListening(true);
    transcript.current = "";
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
        frame.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // No microphone or permission denied: keep the listening UI, flat level.
    }
  }, []);

  const release = useCallback(() => {
    if (!listening) return;
    setListening(false);
    stopCapture();
    onTranscript(transcript.current, true);
  }, [listening, onTranscript, stopCapture]);

  const press = useCallback(
    (mode: VoiceMode) => {
      if (listening && mode === "toggle") release();
      else if (!listening) start();
    },
    [listening, release, start],
  );

  const cancel = useCallback(() => {
    setListening(false);
    stopCapture();
  }, [stopCapture]);

  useEffect(() => stopCapture, [stopCapture]);

  return useMemo(() => ({ listening, level, press, release, cancel }), [listening, level, press, release, cancel]);
}

const BARS = [10, 18, 28, 36, 22, 30, 40, 26, 16, 32, 38, 24, 14, 20];

export function VoiceBar({ level, mode }: { level: number; mode: VoiceMode }) {
  return (
    <div className="voice-bar" role="status">
      <span className="voice-dot" aria-hidden="true" />
      <span className="voice-label">Listening</span>
      <span className="voice-hint">
        {mode === "hold" ? "Release the voice key to search" : "Press the voice key again to search"} ·{" "}
        <Keycap small>Esc</Keycap> to cancel
      </span>
      <div className="voice-wave" aria-hidden="true">
        {BARS.map((h, i) => (
          <span key={i} style={{ height: Math.max(3, h * 0.6 * (0.2 + level)) }} />
        ))}
      </div>
    </div>
  );
}
