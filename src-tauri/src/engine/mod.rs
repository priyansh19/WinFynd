//! The search engine: keeps an index of the user's files up to date and
//! answers searches. Files are read, embedded with EmbeddingGemma 2 through
//! the local Ollama server, and stored in SQLite under the app data folder.
//! Audio and video are transcribed with Whisper and their frames embedded
//! alongside photos.

pub mod config;
mod db;
#[cfg(test)]
pub mod eval;
mod extract;
mod media;
pub mod ollama;
pub mod search;
pub mod speech;
mod vectors;
mod watch;

#[cfg(test)]
mod e2e_tests;

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant, UNIX_EPOCH};

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use config::EngineConfig;
use extract::{Extracted, Kind};
use ollama::{EmbedInput, Ollama};
use speech::Transcribe;
use vectors::VectorIndex;

/// Inputs per embedding request.
const EMBED_BATCH: usize = 16;
/// How often the roots are rescanned to catch anything the watcher missed
/// (and to embed files indexed while Ollama was unavailable).
const RESCAN_EVERY: Duration = Duration::from_secs(20 * 60);
/// Stored with each file; a file whose stamp doesn't match is re-embedded.
const NOT_EMBEDDED: &str = "none";
/// Bumped whenever chunking changes, so every file is re-read on the next scan.
const CHUNKING_VERSION: &str = "c3";

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// idle, scanning, indexing or error.
    pub state: String,
    pub files: i64,
    pub chunks: i64,
    /// Files waiting to be (re)indexed in the current pass.
    pub queued: usize,
    pub current: Option<String>,
    /// ok, offline or modelMissing.
    pub ollama: String,
    pub message: Option<String>,
}

/// One file moving through the indexer, sent as `engine://activity`. Files
/// that are unchanged since the last scan send nothing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub path: String,
    pub name: String,
    /// Same kinds as search results: document, slides, spreadsheet, code,
    /// image, video, audio or other.
    pub kind: &'static str,
    /// reading, embedding, done, or skipped (stored without vectors because
    /// the model wasn't reachable; it's embedded on a later scan).
    pub stage: &'static str,
    /// Chunks stored, on done and skipped.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunks: Option<usize>,
}

type ActivitySink = Box<dyn Fn(&Activity) + Send + Sync>;

pub(crate) enum Job {
    Scan,
    Upsert(PathBuf),
    Remove(PathBuf),
    RemovePrefix(PathBuf),
    Rebuild,
}

pub struct Engine {
    pub(crate) db: Mutex<Connection>,
    pub(crate) vectors: RwLock<VectorIndex>,
    pub(crate) config: RwLock<EngineConfig>,
    config_path: PathBuf,
    status: Mutex<Status>,
    jobs: Sender<Job>,
    watcher: Mutex<Option<watch::Watcher>>,
    emit: Box<dyn Fn(&Status) + Send + Sync>,
    activity: RwLock<Option<ActivitySink>>,
    /// Where Whisper models are downloaded.
    pub(crate) speech_dir: PathBuf,
    /// The loaded speech model and its id, kept between files.
    speech: Mutex<Option<(String, Arc<dyn Transcribe>)>>,
    /// FFmpeg, when installed; needed for video frames.
    ffmpeg: RwLock<Option<PathBuf>>,
}

impl Engine {
    /// Open the index and start the background indexer and folder watcher.
    pub fn start<R: Runtime>(app: &AppHandle<R>) -> Result<Arc<Self>, String> {
        let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let config_path = app.path().app_config_dir().map_err(|e| e.to_string())?.join("engine.json");
        let config = EngineConfig::load(&config_path).unwrap_or_else(|| EngineConfig {
            roots: default_roots(app),
            ..EngineConfig::default()
        });

        let conn = db::open(&data.join("index.sqlite3")).map_err(|e| e.to_string())?;
        let handle = app.clone();
        let (engine, rx) = Self::open(conn, config, config_path, data.join("speech"), move |s| {
            let _ = handle.emit("engine://status", s);
        })?;
        let handle = app.clone();
        engine.on_activity(move |a| {
            let _ = handle.emit("engine://activity", a);
        });

        engine.allow_thumbnails(app);
        engine.restart_watcher();

        let worker = engine.clone();
        std::thread::Builder::new()
            .name("winfynd-indexer".into())
            .spawn(move || worker.run(rx))
            .map_err(|e| e.to_string())?;

        let ticker = engine.jobs.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(RESCAN_EVERY);
            if ticker.send(Job::Scan).is_err() {
                break;
            }
        });

        engine.enqueue(Job::Scan);
        Ok(engine)
    }

    /// Build the engine around an open index without starting any threads.
    fn open(
        conn: Connection,
        config: EngineConfig,
        config_path: PathBuf,
        speech_dir: PathBuf,
        emit: impl Fn(&Status) + Send + Sync + 'static,
    ) -> Result<(Arc<Self>, Receiver<Job>), String> {
        let mut vectors = VectorIndex::new(config.dimensions);
        for (id, v, visual) in db::all_vectors(&conn, config.dimensions).map_err(|e| e.to_string())? {
            vectors.insert(id, &v, visual);
        }
        let (files, chunks) = db::counts(&conn);
        let (tx, rx) = mpsc::channel();
        let engine = Arc::new(Self {
            db: Mutex::new(conn),
            vectors: RwLock::new(vectors),
            config: RwLock::new(config),
            config_path,
            status: Mutex::new(Status {
                state: "idle".into(),
                files,
                chunks,
                ollama: "ok".into(),
                ..Status::default()
            }),
            jobs: tx,
            watcher: Mutex::new(None),
            emit: Box::new(emit),
            activity: RwLock::new(None),
            speech_dir,
            speech: Mutex::new(None),
            ffmpeg: RwLock::new(media::find_ffmpeg()),
        });
        Ok((engine, rx))
    }

    pub(crate) fn enqueue(&self, job: Job) {
        let _ = self.jobs.send(job);
    }

    pub fn status(&self) -> Status {
        self.status.lock().unwrap().clone()
    }

    pub fn config(&self) -> EngineConfig {
        self.config.read().unwrap().clone()
    }

    pub(crate) fn ollama(&self) -> Result<Ollama, String> {
        Ollama::new(&self.config.read().unwrap().ollama_url)
    }

    pub(crate) fn on_activity(&self, f: impl Fn(&Activity) + Send + Sync + 'static) {
        *self.activity.write().unwrap() = Some(Box::new(f));
    }

    fn report(&self, path: &str, name: &str, kind: Kind, stage: &'static str, chunks: Option<usize>) {
        if let Some(f) = self.activity.read().unwrap().as_ref() {
            f(&Activity { path: path.into(), name: name.into(), kind: kind.as_str(), stage, chunks });
        }
    }

    fn update_status(&self, f: impl FnOnce(&mut Status)) {
        let snapshot = {
            let mut s = self.status.lock().unwrap();
            f(&mut s);
            s.clone()
        };
        (self.emit)(&snapshot);
    }

    /// Apply a new configuration. Changing the model or vector size makes old
    /// vectors useless, so the index is rebuilt.
    pub fn set_config<R: Runtime>(&self, app: &AppHandle<R>, new: EngineConfig) -> Result<EngineConfig, String> {
        let old = self.config();
        new.save(&self.config_path)?;
        *self.config.write().unwrap() = new.clone();

        for removed in old.roots.iter().filter(|r| !new.roots.contains(r)) {
            self.enqueue(Job::RemovePrefix(removed.clone()));
        }
        if old.embed_model != new.embed_model || old.dimensions != new.dimensions || old.index_images != new.index_images {
            self.enqueue(Job::Rebuild);
        } else if old.roots != new.roots
            || old.speech_model != new.speech_model
            || old.index_video_frames != new.index_video_frames
        {
            // Media files carry these settings in their stamp, so a scan
            // re-reads just those.
            self.enqueue(Job::Scan);
        }
        self.allow_thumbnails(app);
        self.restart_watcher();
        Ok(new)
    }

    /// Let the launcher show image thumbnails from the indexed folders.
    fn allow_thumbnails<R: Runtime>(&self, app: &AppHandle<R>) {
        let scope = app.asset_protocol_scope();
        for root in &self.config.read().unwrap().roots {
            let _ = scope.allow_directory(root, true);
        }
    }

    fn restart_watcher(&self) {
        let roots = self.config.read().unwrap().roots.clone();
        let w = watch::Watcher::start(&roots, self.jobs.clone());
        *self.watcher.lock().unwrap() = w;
    }

    // ---- background indexer -------------------------------------------------

    fn run(self: Arc<Self>, rx: Receiver<Job>) {
        let mut pending: VecDeque<PathBuf> = VecDeque::new();
        loop {
            // Block for the next job only when there's nothing left to index.
            let job = if pending.is_empty() {
                match rx.recv() {
                    Ok(j) => Some(j),
                    Err(_) => return,
                }
            } else {
                rx.try_recv().ok()
            };

            match job {
                Some(Job::Scan) => {
                    self.update_status(|s| {
                        s.state = "scanning".into();
                        s.message = None;
                    });
                    self.refresh_ffmpeg();
                    // Media is slow to transcribe, so it goes after everything else.
                    let (media, other): (Vec<_>, Vec<_>) =
                        self.walk_roots().into_iter().partition(|p| is_media(extract::kind_of(p)));
                    for p in other.into_iter().chain(media) {
                        if !pending.contains(&p) {
                            pending.push_back(p);
                        }
                    }
                    self.refresh_ollama_state();
                }
                Some(Job::Upsert(p)) => {
                    if !pending.contains(&p) {
                        pending.push_front(p);
                    }
                }
                Some(Job::Remove(p)) => {
                    pending.retain(|q| q != &p);
                    self.remove_path(&p);
                }
                Some(Job::RemovePrefix(p)) => {
                    pending.retain(|q| !q.starts_with(&p));
                    self.remove_prefix(&p);
                }
                Some(Job::Rebuild) => {
                    pending.clear();
                    let dims = self.config.read().unwrap().dimensions;
                    let _ = db::clear(&self.db.lock().unwrap());
                    *self.vectors.write().unwrap() = VectorIndex::new(dims);
                    let _ = self.jobs.send(Job::Scan);
                }
                None => {}
            }

            // Index a few files between checks for new jobs, so removals and
            // fresh files from the watcher are handled promptly.
            let started = Instant::now();
            while let Some(p) = pending.pop_front() {
                self.update_status(|s| {
                    s.state = "indexing".into();
                    s.queued = pending.len() + 1;
                    s.current = Some(p.display().to_string());
                });
                self.index_file(&p);
                if started.elapsed() > Duration::from_millis(500) {
                    break;
                }
            }

            if pending.is_empty() {
                let (files, chunks) = db::counts(&self.db.lock().unwrap());
                self.update_status(|s| {
                    if s.state != "error" {
                        s.state = "idle".into();
                    }
                    s.queued = 0;
                    s.current = None;
                    s.files = files;
                    s.chunks = chunks;
                });
            }
        }
    }

    fn refresh_ollama_state(&self) {
        let model = self.config.read().unwrap().embed_model.clone();
        let state = match self.ollama().and_then(|o| o.models()) {
            Ok(models) if ollama::has_model(&models, &model) => ("ok", None),
            Ok(_) => ("modelMissing", Some(format!("Download {model} on the Models page to search by meaning."))),
            Err(e) => ("offline", Some(e)),
        };
        self.update_status(|s| {
            s.ollama = state.0.into();
            s.message = state.1;
        });
    }

    fn walk_roots(&self) -> Vec<PathBuf> {
        let roots = self.config.read().unwrap().roots.clone();
        let mut out = Vec::new();
        for root in roots {
            let walker = walkdir::WalkDir::new(&root).follow_links(false).into_iter();
            for entry in walker.filter_entry(|e| e.depth() == 0 || !is_excluded(e.path())) {
                let Ok(entry) = entry else { continue };
                if entry.file_type().is_file() {
                    out.push(entry.into_path());
                }
            }
        }
        out
    }

    fn remove_path(&self, path: &Path) {
        let key = path.to_string_lossy();
        let ids = {
            let db = self.db.lock().unwrap();
            let mut ids = db::remove_file(&db, &key).unwrap_or_default();
            // A deleted folder arrives as one event for the folder itself.
            let prefix = format!("{}{}", key.trim_end_matches(std::path::MAIN_SEPARATOR), std::path::MAIN_SEPARATOR);
            ids.extend(db::remove_prefix(&db, &prefix).unwrap_or_default());
            ids
        };
        let mut v = self.vectors.write().unwrap();
        ids.into_iter().for_each(|id| v.remove(id));
    }

    fn remove_prefix(&self, root: &Path) {
        let prefix = root.to_string_lossy().to_string();
        let ids = db::remove_prefix(&self.db.lock().unwrap(), &prefix).unwrap_or_default();
        let mut v = self.vectors.write().unwrap();
        ids.into_iter().for_each(|id| v.remove(id));
    }

    fn index_file(&self, path: &Path) {
        let Ok(meta) = std::fs::metadata(path) else {
            self.remove_path(path);
            return;
        };
        if !meta.is_file() || is_excluded(path) {
            return;
        }
        let size = meta.len() as i64;
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let cfg = self.config();
        let kind = extract::kind_of(path);
        // A cloud-only OneDrive file is stamped as such, so it's read again
        // once it's downloaded (which keeps its size and modified time).
        let cloud_only = is_cloud_placeholder(&meta);
        let model_key = self.model_key(&cfg, kind) + if cloud_only { "+cloud" } else { "" };
        let key = path.to_string_lossy().to_string();
        if let Ok(Some((s, m, model))) = db::file_stamp(&self.db.lock().unwrap(), &key) {
            if s == size && m == mtime && model == model_key {
                return;
            }
        }

        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        self.report(&key, &name, kind, "reading", None);
        // Cloud-only OneDrive files would be downloaded just to read them:
        // index those by name until they're on disk.
        let extracted = if cloud_only {
            Extracted::NameOnly
        } else if is_media(kind) {
            self.extract_media(&cfg, path, &name, kind)
        } else {
            extract::extract(path, kind, cfg.index_images)
        };

        let (inputs, mut chunks) = plan_chunks(path, &name, kind, mtime, extracted);
        self.report(&key, &name, kind, "embedding", None);
        let embedded = self.embed_all(&cfg, inputs);
        let stamp = match &embedded {
            Ok(vectors) => {
                for (c, v) in chunks.iter_mut().zip(vectors) {
                    c.vector = v.clone();
                }
                model_key
            }
            Err(e) => {
                let msg = e.clone();
                self.update_status(|s| {
                    s.ollama = "offline".into();
                    s.message = Some(msg);
                });
                NOT_EMBEDDED.to_string()
            }
        };

        let stored = chunks.len();
        let stage = if embedded.is_ok() { "done" } else { "skipped" };
        let result = db::upsert_file(&mut self.db.lock().unwrap(), &key, &name, kind.as_str(), size, mtime, &stamp, chunks);
        if let Ok((removed, added)) = result {
            let mut v = self.vectors.write().unwrap();
            removed.into_iter().for_each(|id| v.remove(id));
            added.iter().for_each(|(id, vec, visual)| v.insert(*id, vec, *visual));
        }
        self.report(&key, &name, kind, stage, Some(stored));
    }

    /// What a file's stored vectors depend on. Media also depends on the
    /// speech model and on whether frames could be read, so installing
    /// either re-reads audio and video on the next scan.
    fn model_key(&self, cfg: &EngineConfig, kind: Kind) -> String {
        let mut key = format!(
            "{}@{}{}+{CHUNKING_VERSION}",
            cfg.embed_model,
            cfg.dimensions,
            if cfg.index_images { "+img" } else { "" }
        );
        if is_media(kind) {
            if speech::is_installed(&self.speech_dir, &cfg.speech_model) {
                key.push_str(&format!("+asr:{}", cfg.speech_model));
            }
            if kind == Kind::Video && self.frames_enabled(cfg) {
                key.push_str("+frames");
            }
        }
        key
    }

    fn frames_enabled(&self, cfg: &EngineConfig) -> bool {
        cfg.index_images && cfg.index_video_frames && self.ffmpeg.read().unwrap().is_some()
    }

    pub(crate) fn ffmpeg_path(&self) -> Option<PathBuf> {
        self.ffmpeg.read().unwrap().clone()
    }

    /// Look for FFmpeg again (it may have been installed since startup).
    pub(crate) fn refresh_ffmpeg(&self) -> Option<PathBuf> {
        let found = media::find_ffmpeg();
        *self.ffmpeg.write().unwrap() = found.clone();
        found
    }

    /// The speech model named in the config, loaded once and reused.
    fn transcriber(&self, cfg: &EngineConfig) -> Option<Arc<dyn Transcribe>> {
        let mut slot = self.speech.lock().unwrap();
        if let Some((id, t)) = slot.as_ref() {
            if *id == cfg.speech_model {
                return Some(t.clone());
            }
        }
        if !speech::is_installed(&self.speech_dir, &cfg.speech_model) {
            return None;
        }
        match speech::Whisper::load(&speech::model_path(&self.speech_dir, &cfg.speech_model)) {
            Ok(w) => {
                let t: Arc<dyn Transcribe> = Arc::new(w);
                *slot = Some((cfg.speech_model.clone(), t.clone()));
                Some(t)
            }
            Err(e) => {
                self.update_status(|s| s.message = Some(e));
                None
            }
        }
    }

    /// What's said in a recording and, for video, what's shown.
    fn extract_media(&self, cfg: &EngineConfig, path: &Path, name: &str, kind: Kind) -> Extracted {
        let ffmpeg = self.ffmpeg_path();
        let mut transcript = Vec::new();
        if let Some(t) = self.transcriber(cfg) {
            self.update_status(|s| s.current = Some(format!("Transcribing {name}")));
            let mut segments = Vec::new();
            media::decode_audio(path, ffmpeg.as_deref(), |piece, offset| {
                if let Ok(segs) = t.transcribe(piece) {
                    segments.extend(segs.into_iter().map(|s| media::Segment { start: s.start + offset, ..s }));
                }
            });
            transcript = media::transcript_chunks(&segments);
        }
        let mut frames = Vec::new();
        if kind == Kind::Video && self.frames_enabled(cfg) {
            if let Some(ff) = &ffmpeg {
                self.update_status(|s| s.current = Some(format!("Looking through {name}")));
                frames = media::video_frames(ff, path);
            }
        }
        Extracted::Media { transcript, frames }
    }

    /// One vector per input, or None for a picture the model couldn't take.
    fn embed_all(&self, cfg: &EngineConfig, inputs: Vec<EmbedInput>) -> Result<Vec<Option<Vec<f32>>>, String> {
        let status = self.status.lock().unwrap().ollama.clone();
        if status != "ok" {
            return Err(self.status.lock().unwrap().message.clone().unwrap_or_else(|| "Ollama unavailable".into()));
        }
        let ollama = self.ollama()?;
        let mut out = Vec::with_capacity(inputs.len());
        for batch in inputs.chunks(EMBED_BATCH) {
            match ollama.embed(&cfg.embed_model, batch, cfg.dimensions) {
                Ok(vs) => out.extend(vs.into_iter().map(Some)),
                // A model tag or Ollama version without image support rejects
                // pictures, and one broken picture fails its whole batch.
                // Neither may stop the rest (or text) from being embedded, nor
                // mark Ollama as offline: retry text together, then each
                // picture on its own.
                Err(e) if batch.iter().any(EmbedInput::is_image) => {
                    let text: Vec<&EmbedInput> = batch.iter().filter(|i| !i.is_image()).collect();
                    let mut vs = if text.is_empty() {
                        Vec::new()
                    } else {
                        ollama.embed_refs(&cfg.embed_model, &text, cfg.dimensions)?
                    }
                    .into_iter();
                    let mut rejected = 0;
                    for input in batch {
                        if input.is_image() {
                            let one = ollama.embed_refs(&cfg.embed_model, &[input], cfg.dimensions).ok().and_then(|mut v| v.pop());
                            rejected += usize::from(one.is_none());
                            out.push(one);
                        } else {
                            out.push(vs.next());
                        }
                    }
                    if rejected > 0 {
                        self.update_status(|s| {
                            s.message = Some(format!(
                                "{rejected} picture(s) couldn't be embedded by {} ({e}). If no photos show up in \
                                 searches, update Ollama and use the 740m tag of EmbeddingGemma 2.",
                                cfg.embed_model
                            ))
                        });
                    }
                }
                Err(e) => return Err(e),
            }
        }
        Ok(out)
    }
}

/// What to store for a file and what to send to the embedder, in the same order.
///
/// Every file starts with a card: one vector for the file as a whole (its
/// name, folders, kind, date and opening text), so files are found as files
/// and not only through fragments. Each text chunk is embedded with where it
/// sits (folder, page or slide) in front of it, so a bare "Q3 total 4,210"
/// still says which file it belongs to.
fn plan_chunks(path: &Path, name: &str, kind: Kind, mtime: i64, extracted: Extracted) -> (Vec<EmbedInput>, Vec<db::NewChunk>) {
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| name.to_string());
    let title = name_words(&stem);
    let folders = folder_words(path);
    let opening = match &extracted {
        Extracted::Text(text) => text.iter().map(|c| c.text.as_str()).collect::<Vec<_>>().join(" ").chars().take(600).collect(),
        Extracted::Media { transcript, .. } => transcript.first().map(|c| c.text.chars().take(600).collect()).unwrap_or_default(),
        _ => String::new(),
    };
    let (card_input, card) = file_card(&title, &folders, kind, mtime, &opening);
    let mut inputs = vec![card_input];
    let mut chunks = vec![card];
    let context = |label: &Option<String>| match label {
        Some(l) => format!("{folders} › {l}"),
        None => folders.clone(),
    };
    match extracted {
        Extracted::Text(text) => {
            // Logs, data and config are found by exact words; only their card
            // is embedded. It comes first, so vectors still line up.
            let embed = !extract::keyword_only(path);
            for c in text {
                if embed {
                    inputs.push(EmbedInput::Document { title: title.clone(), text: format!("{}\n{}", context(&c.label), c.text) });
                }
                chunks.push(db::NewChunk { label: c.label, text: Some(c.text), vector: None, visual: false });
            }
        }
        Extracted::Image(b64) => {
            inputs.push(EmbedInput::Image(b64));
            chunks.push(db::NewChunk { label: None, text: None, vector: None, visual: true });
        }
        Extracted::NameOnly => {}
        Extracted::Media { transcript, frames } => {
            for c in transcript {
                inputs.push(EmbedInput::Document { title: title.clone(), text: format!("{}\n{}", context(&c.label), c.text) });
                chunks.push(db::NewChunk { label: c.label, text: Some(c.text), vector: None, visual: false });
            }
            for (at, b64) in frames {
                inputs.push(EmbedInput::Image(b64));
                chunks.push(db::NewChunk { label: Some(at), text: None, vector: None, visual: true });
            }
        }
    }
    (inputs, chunks)
}

/// The file card: found by what its name, folders, date and opening say.
fn file_card(title: &str, folders: &str, kind: Kind, mtime: i64, opening: &str) -> (EmbedInput, db::NewChunk) {
    let year = 1970 + mtime.max(0) / 31_556_952;
    let mut text = format!("{} file in {folders}, from {year}", kind.as_str());
    if !opening.is_empty() {
        text.push_str(". ");
        text.push_str(opening);
    }
    (
        EmbedInput::Document { title: title.to_string(), text },
        db::NewChunk { label: None, text: None, vector: None, visual: false },
    )
}

/// The last two folders of a path as words: "Finance / Taxes 2025".
fn folder_words(path: &Path) -> String {
    let folders: Vec<String> = path
        .parent()
        .map(|p| {
            p.components()
                .rev()
                .take(2)
                .map(|c| c.as_os_str().to_string_lossy().to_string())
                .filter(|c| !c.is_empty() && !c.ends_with(':') && !c.ends_with('\\') && c != "/")
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    folders.into_iter().rev().map(|f| name_words(&f)).collect::<Vec<_>>().join(" / ")
}

/// "taxReturn_2025-final" → "tax Return 2025 final".
pub(crate) fn name_words(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 8);
    let mut prev: Option<char> = None;
    for c in name.chars() {
        if !c.is_alphanumeric() {
            if !out.ends_with(' ') && !out.is_empty() {
                out.push(' ');
            }
        } else {
            let boundary = match prev {
                Some(p) => (p.is_lowercase() && c.is_uppercase()) || (p.is_alphabetic() != c.is_alphabetic() && p.is_alphanumeric()),
                None => false,
            };
            if boundary && !out.ends_with(' ') {
                out.push(' ');
            }
            out.push(c);
        }
        prev = Some(c);
    }
    out.trim().to_string()
}

fn is_media(kind: Kind) -> bool {
    matches!(kind, Kind::Audio | Kind::Video)
}

fn default_roots<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    let p = app.path();
    [p.document_dir(), p.desktop_dir(), p.download_dir(), p.picture_dir()]
        .into_iter()
        .filter_map(Result::ok)
        .filter(|d| d.is_dir())
        .collect()
}

/// Folders and files that are never indexed: hidden, system, build output,
/// dependency caches and Office lock files.
pub(crate) fn is_excluded(path: &Path) -> bool {
    const SKIP: &[&str] = &[
        "node_modules", "target", "__pycache__", "venv", "AppData", "$RECYCLE.BIN", "System Volume Information",
        "Windows", "Program Files", "Program Files (x86)", "site-packages", "bin", "obj", "dist", "build",
        "vendor", "bower_components", "Pods", "DerivedData", "coverage", "$WinREAgent", "OneDriveTemp",
    ];
    path.components().any(|c| {
        let s = c.as_os_str().to_string_lossy();
        (s.starts_with('.') && s.len() > 1 && s != "..") || s.starts_with("~$") || SKIP.iter().any(|k| s.eq_ignore_ascii_case(k))
    })
}

#[cfg(windows)]
fn is_cloud_placeholder(meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_OFFLINE: u32 = 0x1000;
    const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x40000;
    const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x400000;
    meta.file_attributes() & (FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS) != 0
}

#[cfg(not(windows))]
fn is_cloud_placeholder(_meta: &std::fs::Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_become_words() {
        assert_eq!(name_words("taxReturn_2025-final"), "tax Return 2025 final");
        assert_eq!(name_words("IMG_2041"), "IMG 2041");
        assert_eq!(name_words("Screenshot 2026-10-12 101500"), "Screenshot 2026 10 12 101500");
    }

    #[test]
    fn exclusions() {
        assert!(is_excluded(Path::new("/home/u/proj/node_modules/x.js")));
        assert!(is_excluded(Path::new("/home/u/.git/config")));
        assert!(is_excluded(Path::new("/home/u/Docs/~$report.docx")));
        assert!(!is_excluded(Path::new("/home/u/Documents/report.docx")));
    }
}
