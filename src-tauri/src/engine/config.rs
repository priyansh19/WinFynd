//! What WinFynd indexes and which local models it uses, saved as JSON in the
//! app config folder.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EngineConfig {
    /// Folders that are scanned and watched.
    pub roots: Vec<PathBuf>,
    /// Local Ollama server. Only loopback is ever contacted.
    pub ollama_url: String,
    /// EmbeddingGemma 2 by default: text and images share one vector space.
    pub embed_model: String,
    /// Vector size; EmbeddingGemma 2 supports 768, 512, 256 and 128.
    pub dimensions: usize,
    /// Chat model for Ask mode. Empty means "first installed non-embedding model".
    pub chat_model: String,
    /// Embed images (needs a vision-capable embedding tag, e.g. 740m).
    pub index_images: bool,
    /// Whisper model id for transcribing audio and video; empty means off.
    pub speech_model: String,
    /// Embed sampled video frames (needs FFmpeg and `index_images`).
    pub index_video_frames: bool,
    /// Read OneDrive files that are only online, which downloads each one.
    /// Off: they're found by name until they're on this PC.
    pub read_online_files: bool,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            roots: Vec::new(),
            ollama_url: "http://127.0.0.1:11434".into(),
            embed_model: "embeddinggemma-2".into(),
            dimensions: 768,
            chat_model: String::new(),
            index_images: true,
            speech_model: String::new(),
            index_video_frames: true,
            read_online_files: false,
        }
    }
}

impl EngineConfig {
    pub fn load(path: &Path) -> Option<Self> {
        fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok())
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())
    }
}
