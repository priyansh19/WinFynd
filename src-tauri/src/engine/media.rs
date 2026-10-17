//! Audio and video: the sound track is decoded to 16 kHz mono for speech
//! recognition, and video frames are sampled for EmbeddingGemma 2. Frames
//! need FFmpeg; audio decodes without it for the common formats.

use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use base64::Engine as _;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use super::extract::TextChunk;

/// Whisper's input rate.
pub const SAMPLE_RATE: usize = 16_000;
/// Audio is handed to the recognizer in pieces this long, so a long
/// recording never has to fit in memory at once.
pub const PIECE_SECONDS: usize = 10 * 60;
/// Nothing past this point of a recording is transcribed.
pub const MAX_SECONDS: usize = 4 * 3600;
/// Frames sampled from one video, at most.
const MAX_FRAMES: usize = 48;
const FRAME_SIDE: u32 = 896;
/// About 250 tokens per transcript chunk, like documents.
const WINDOW_CHARS: usize = 1000;
const MAX_TRANSCRIPT_CHUNKS: usize = 300;

/// A stretch of recognized speech; times in seconds from the start.
#[derive(Debug, Clone)]
pub struct Segment {
    pub start: f64,
    pub text: String,
}

/// FFmpeg on PATH, or where winget and common manual installs put it.
pub fn find_ffmpeg() -> Option<PathBuf> {
    let exe = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let mut candidates: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).map(|d| d.join(exe)).collect())
        .unwrap_or_default();
    if cfg!(windows) {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local).join("Microsoft").join("WinGet").join("Links").join(exe));
        }
        candidates.push(PathBuf::from(r"C:\ffmpeg\bin").join(exe));
        candidates.push(PathBuf::from(r"C:\Program Files\ffmpeg\bin").join(exe));
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// A command that never flashes a console window on Windows.
fn ffmpeg_command(ffmpeg: &Path) -> Command {
    let mut cmd = Command::new(ffmpeg);
    cmd.arg("-nostdin").arg("-hide_banner").stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Decode the sound track as 16 kHz mono and hand it over in pieces of up to
/// `PIECE_SECONDS`, with each piece's start time. Returns false if the file
/// had no decodable audio.
pub fn decode_audio(path: &Path, ffmpeg: Option<&Path>, mut on_piece: impl FnMut(&[f32], f64)) -> bool {
    let mut pieces = Pieces::new(&mut on_piece);
    let ok = match ffmpeg {
        Some(ff) => decode_with_ffmpeg(ff, path, &mut pieces) || decode_with_symphonia(path, &mut pieces),
        None => decode_with_symphonia(path, &mut pieces),
    };
    pieces.finish();
    ok && pieces.total > 0
}

/// Collects samples into fixed-length pieces.
struct Pieces<'a> {
    buf: Vec<f32>,
    total: usize,
    sink: &'a mut dyn FnMut(&[f32], f64),
}

impl<'a> Pieces<'a> {
    fn new(sink: &'a mut dyn FnMut(&[f32], f64)) -> Self {
        Self { buf: Vec::new(), total: 0, sink }
    }

    /// False once the length cap is reached.
    fn push(&mut self, samples: &[f32]) -> bool {
        let room = MAX_SECONDS * SAMPLE_RATE - self.total - self.buf.len();
        let take = samples.len().min(room);
        self.buf.extend_from_slice(&samples[..take]);
        if self.buf.len() >= PIECE_SECONDS * SAMPLE_RATE {
            self.flush();
        }
        take == samples.len()
    }

    fn flush(&mut self) {
        if !self.buf.is_empty() {
            (self.sink)(&self.buf, self.total as f64 / SAMPLE_RATE as f64);
            self.total += self.buf.len();
            self.buf.clear();
        }
    }

    fn finish(&mut self) {
        self.flush();
    }
}

fn decode_with_ffmpeg(ffmpeg: &Path, path: &Path, pieces: &mut Pieces) -> bool {
    let child = ffmpeg_command(ffmpeg)
        .args(["-v", "error", "-i"])
        .arg(path)
        .args(["-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-t"])
        .arg(MAX_SECONDS.to_string())
        .arg("pipe:1")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let Ok(mut child) = child else { return false };
    let Some(mut out) = child.stdout.take() else { return false };
    let mut bytes = vec![0u8; 64 * 1024];
    let mut carry: Vec<u8> = Vec::new();
    let mut got_any = false;
    loop {
        let n = match out.read(&mut bytes) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        carry.extend_from_slice(&bytes[..n]);
        let whole = carry.len() / 4 * 4;
        let samples: Vec<f32> =
            carry[..whole].chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
        carry.drain(..whole);
        got_any |= !samples.is_empty();
        if !pieces.push(&samples) {
            break;
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    got_any
}

fn decode_with_symphonia(path: &Path, pieces: &mut Pieces) -> bool {
    // Decoders for third-party formats can panic on damaged files.
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| symphonia_inner(path, pieces))).unwrap_or(false)
}

fn symphonia_inner(path: &Path, pieces: &mut Pieces) -> bool {
    let Ok(file) = File::open(path) else { return false };
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let Ok(probed) =
        symphonia::default::get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
    else {
        return false;
    };
    let mut format = probed.format;
    let Some(track) = format.tracks().iter().find(|t| t.codec_params.codec != CODEC_TYPE_NULL) else {
        return false;
    };
    let track_id = track.id;
    let Some(rate) = track.codec_params.sample_rate else { return false };
    let Ok(mut decoder) = symphonia::default::get_codecs().make(&track.codec_params, &DecoderOptions::default()) else {
        return false;
    };

    let mut resampler = Resampler::new(rate as usize, SAMPLE_RATE);
    let mut got_any = false;
    let mut mono = Vec::new();
    let mut out = Vec::new();
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::ResetRequired) => continue,
            Err(_) => break,
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(_) => break,
        };
        let spec = *decoded.spec();
        let channels = spec.channels.count().max(1);
        let mut buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        buf.copy_interleaved_ref(decoded);
        mono.clear();
        mono.extend(buf.samples().chunks_exact(channels).map(|f| f.iter().sum::<f32>() / channels as f32));
        out.clear();
        resampler.push(&mono, &mut out);
        got_any |= !out.is_empty();
        if !pieces.push(&out) {
            break;
        }
    }
    got_any
}

/// Streaming rate conversion: each output sample is the average of the input
/// samples it covers, which is plenty for speech recognition.
struct Resampler {
    /// Input samples per output sample.
    step: f64,
    buf: Vec<f32>,
    /// Centre of the next output sample, in `buf` coordinates.
    pos: f64,
}

impl Resampler {
    fn new(from: usize, to: usize) -> Self {
        Self { step: from as f64 / to as f64, buf: Vec::new(), pos: 0.0 }
    }

    fn push(&mut self, input: &[f32], out: &mut Vec<f32>) {
        self.buf.extend_from_slice(input);
        let half = (self.step / 2.0).max(0.5);
        while self.pos + half <= self.buf.len() as f64 {
            let lo = (self.pos - half).max(0.0).floor() as usize;
            let hi = ((self.pos + half).ceil() as usize).min(self.buf.len()).max(lo + 1);
            let window = &self.buf[lo..hi];
            out.push(window.iter().sum::<f32>() / window.len() as f32);
            self.pos += self.step;
        }
        let consumed = ((self.pos - half).floor().max(0.0) as usize).min(self.buf.len());
        self.buf.drain(..consumed);
        self.pos -= consumed as f64;
    }
}

/// Length in seconds, from FFmpeg's probe output.
fn duration(ffmpeg: &Path, path: &Path) -> Option<f64> {
    let out = ffmpeg_command(ffmpeg).arg("-i").arg(path).stdout(Stdio::null()).output().ok()?;
    let text = String::from_utf8_lossy(&out.stderr);
    let after = text.split("Duration: ").nth(1)?;
    let stamp = after.split(',').next()?.trim();
    let mut secs = 0.0;
    for part in stamp.split(':') {
        secs = secs * 60.0 + part.parse::<f64>().ok()?;
    }
    Some(secs)
}

/// Evenly spaced frames from a video as (timestamp label, base64 JPEG),
/// skipping frames that look the same as the one before.
pub fn video_frames(ffmpeg: &Path, path: &Path) -> Vec<(String, String)> {
    let length = duration(ffmpeg, path).unwrap_or(0.0);
    let interval = (length / MAX_FRAMES as f64).clamp(5.0, 600.0);
    let offset = (interval / 2.0).min(length / 2.0);

    static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("winfynd-frames-{}-{n}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    if fs::create_dir_all(&dir).is_err() {
        return Vec::new();
    }

    let filter = format!(
        "fps=1/{interval:.3},scale={FRAME_SIDE}:{FRAME_SIDE}:force_original_aspect_ratio=decrease"
    );
    let status = ffmpeg_command(ffmpeg)
        .args(["-v", "error", "-ss"])
        .arg(format!("{offset:.3}"))
        .arg("-i")
        .arg(path)
        .args(["-an", "-sn", "-vf", &filter, "-frames:v"])
        .arg(MAX_FRAMES.to_string())
        .args(["-q:v", "4"])
        .arg(dir.join("f%04d.jpg"))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    let mut frames = Vec::new();
    if status.is_ok() {
        let mut files: Vec<PathBuf> = fs::read_dir(&dir)
            .map(|rd| rd.filter_map(Result::ok).map(|e| e.path()).collect())
            .unwrap_or_default();
        files.sort();
        let mut last: Option<Vec<u8>> = None;
        for (i, f) in files.iter().enumerate() {
            let Ok(bytes) = fs::read(f) else { continue };
            let print = fingerprint(&bytes);
            if let (Some(a), Some(b)) = (&last, &print) {
                if difference(a, b) < 6.0 {
                    continue;
                }
            }
            if print.is_some() {
                last = print;
            }
            let at = offset + i as f64 * interval;
            frames.push((timestamp(at), base64::engine::general_purpose::STANDARD.encode(&bytes)));
        }
    }
    let _ = fs::remove_dir_all(&dir);
    frames
}

/// A 16x16 grayscale thumbnail, to spot near-identical frames cheaply.
fn fingerprint(jpeg: &[u8]) -> Option<Vec<u8>> {
    let img = image::load_from_memory(jpeg).ok()?;
    Some(img.resize_exact(16, 16, image::imageops::FilterType::Triangle).to_luma8().into_raw())
}

/// Mean absolute difference per pixel, 0 to 255.
fn difference(a: &[u8], b: &[u8]) -> f32 {
    let sum: u32 = a.iter().zip(b).map(|(x, y)| x.abs_diff(*y) as u32).sum();
    sum as f32 / a.len().max(1) as f32
}

/// "0:42", "12:05" or "1:02:03".
pub fn timestamp(secs: f64) -> String {
    let s = secs.max(0.0) as u64;
    let (h, m, s) = (s / 3600, s / 60 % 60, s % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}

/// True for labels made by `timestamp`.
pub fn is_timestamp(label: &str) -> bool {
    label.contains(':') && label.chars().all(|c| c.is_ascii_digit() || c == ':')
}

/// Group speech segments into search-sized chunks, labelled with the time
/// the chunk starts.
pub fn transcript_chunks(segments: &[Segment]) -> Vec<TextChunk> {
    let mut out: Vec<TextChunk> = Vec::new();
    let mut text = String::new();
    let mut start = 0.0;
    for seg in segments {
        let t = seg.text.trim();
        if t.is_empty() {
            continue;
        }
        if text.is_empty() {
            start = seg.start;
        }
        if !text.is_empty() {
            text.push(' ');
        }
        text.push_str(t);
        if text.chars().count() >= WINDOW_CHARS {
            out.push(TextChunk { label: Some(timestamp(start)), text: std::mem::take(&mut text) });
            if out.len() >= MAX_TRANSCRIPT_CHUNKS {
                return out;
            }
        }
    }
    if !text.is_empty() {
        out.push(TextChunk { label: Some(timestamp(start)), text });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps() {
        assert_eq!(timestamp(42.7), "0:42");
        assert_eq!(timestamp(725.0), "12:05");
        assert_eq!(timestamp(3723.0), "1:02:03");
        assert!(is_timestamp("1:02:03") && !is_timestamp("Page 3") && !is_timestamp("12"));
    }

    #[test]
    fn resampler_keeps_duration() {
        let mut r = Resampler::new(48_000, 16_000);
        let mut out = Vec::new();
        for _ in 0..10 {
            r.push(&vec![0.5; 4800], &mut out);
        }
        assert!((out.len() as i64 - 16_000).abs() <= 2, "{}", out.len());
        assert!(out.iter().all(|s| (s - 0.5).abs() < 1e-6));
    }

    #[test]
    fn transcript_chunks_carry_start_times() {
        let segs: Vec<Segment> = (0..40)
            .map(|i| Segment { start: i as f64 * 10.0, text: "word ".repeat(10) })
            .collect();
        let chunks = transcript_chunks(&segs);
        assert!(chunks.len() > 1);
        assert_eq!(chunks[0].label.as_deref(), Some("0:00"));
        assert!(chunks[1].label.as_deref().unwrap() != "0:00");
    }
}
