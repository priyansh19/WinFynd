//! Speech recognition on this PC with Whisper (whisper.cpp). Models are
//! downloaded once, when the user asks, into the app data folder.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use super::media::{Segment, SAMPLE_RATE};

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechModel {
    pub id: &'static str,
    pub label: &'static str,
    pub size_mb: u32,
    pub note: &'static str,
}

/// Multilingual Whisper models from the whisper.cpp model repository.
pub const CATALOG: [SpeechModel; 3] = [
    SpeechModel { id: "base", label: "Whisper Base", size_mb: 148, note: "Fastest; fine for clear speech" },
    SpeechModel { id: "small", label: "Whisper Small", size_mb: 488, note: "Balanced speed and accuracy" },
    SpeechModel {
        id: "large-v3-turbo-q5_0",
        label: "Whisper Large v3 Turbo",
        size_mb: 574,
        note: "Most accurate; slower on CPU",
    },
];

pub fn model_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("ggml-{id}.bin"))
}

pub fn is_installed(dir: &Path, id: &str) -> bool {
    !id.is_empty() && model_path(dir, id).is_file()
}

/// Download a model, reporting (downloaded, total) bytes. Written to a
/// temporary name first so a cancelled download never looks installed.
pub fn download(dir: &Path, id: &str, mut progress: impl FnMut(u64, u64)) -> Result<(), String> {
    if !CATALOG.iter().any(|m| m.id == id) {
        return Err(format!("Unknown speech model {id}"));
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{id}.bin");
    let http = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(6 * 3600))
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = http
        .get(url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Couldn't download the speech model: {e}"))?;
    let total = resp.content_length().unwrap_or(0);
    let part = dir.join(format!("ggml-{id}.bin.part"));
    let mut file = File::create(&part).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 256 * 1024];
    let mut done = 0u64;
    let mut last = 0u64;
    loop {
        let n = resp.read(&mut buf).map_err(|e| format!("Download interrupted: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        done += n as u64;
        if done - last > 2 * 1024 * 1024 {
            last = done;
            progress(done, total);
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    if total > 0 && done != total {
        let _ = fs::remove_file(&part);
        return Err("Download was incomplete; try again".into());
    }
    fs::rename(&part, model_path(dir, id)).map_err(|e| e.to_string())?;
    progress(done, done);
    Ok(())
}

/// Something that turns 16 kHz mono audio into timed text.
pub trait Transcribe: Send + Sync {
    fn transcribe(&self, samples: &[f32]) -> Result<Vec<Segment>, String>;
}

pub struct Whisper {
    ctx: WhisperContext,
}

impl Whisper {
    pub fn load(path: &Path) -> Result<Self, String> {
        // Route whisper.cpp's logging away from stdout.
        whisper_rs::install_logging_hooks();
        let path = path.to_str().ok_or("Model path isn't valid UTF-8")?;
        let ctx = WhisperContext::new_with_params(path, WhisperContextParameters::default())
            .map_err(|e| format!("Couldn't load the speech model: {e}"))?;
        Ok(Self { ctx })
    }
}

impl Transcribe for Whisper {
    fn transcribe(&self, samples: &[f32]) -> Result<Vec<Segment>, String> {
        // Whisper needs at least a second of audio.
        if samples.len() < SAMPLE_RATE {
            return Ok(Vec::new());
        }
        let mut state = self.ctx.create_state().map_err(|e| e.to_string())?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        // Leave a core free so the PC stays responsive while indexing.
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).saturating_sub(1).clamp(1, 8);
        params.set_n_threads(threads as i32);
        params.set_language(Some("auto"));
        params.set_translate(false);
        params.set_suppress_blank(true);
        params.set_suppress_nst(true);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        state.full(params, samples).map_err(|e| e.to_string())?;

        let mut out: Vec<Segment> = Vec::new();
        for seg in state.as_iter() {
            if seg.no_speech_probability() > 0.8 {
                continue;
            }
            let text = seg.to_str_lossy().map(|t| t.trim().to_string()).unwrap_or_default();
            // Silence and music make Whisper repeat itself; keep one copy.
            if text.is_empty() || out.last().is_some_and(|p| p.text == text) {
                continue;
            }
            // Timestamps come in hundredths of a second.
            out.push(Segment { start: seg.start_timestamp() as f64 / 100.0, text });
        }
        Ok(out)
    }
}
