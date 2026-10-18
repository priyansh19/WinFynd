//! The search engine: keeps an index of the user's files up to date and
//! answers searches. Files are read, embedded with EmbeddingGemma 2 through
//! the local Ollama server, and stored in SQLite under the app data folder.
//! Audio and video are transcribed with Whisper and their frames embedded
//! alongside photos.

pub mod config;
mod db;
mod extract;
mod media;
pub mod ollama;
mod queue;
pub mod search;
pub mod speech;
mod vectors;
mod watch;

#[cfg(test)]
mod e2e_tests;
#[cfg(test)]
mod stress_tests;

use std::panic::AssertUnwindSafe;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, RwLock, Weak};
use std::time::{Duration, Instant, UNIX_EPOCH};

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use config::EngineConfig;
use extract::{Extracted, Kind};
use ollama::{EmbedInput, Ollama};
use queue::Pending;
use speech::Transcribe;
use vectors::VectorIndex;

/// Inputs per embedding request.
const EMBED_BATCH: usize = 16;
/// How often the roots are rescanned to catch anything the watcher missed
/// (and to embed files indexed while Ollama was unavailable).
const RESCAN_EVERY: Duration = Duration::from_secs(20 * 60);
/// Stored with each file; a file whose stamp doesn't match is re-embedded.
const NOT_EMBEDDED: &str = "none";
/// Status changes are sent to the windows at most this often. Sending one
/// per file flooded the window thread during big scans and froze the app.
pub(crate) const STATUS_EVERY: Duration = Duration::from_millis(250);
/// Longest a document may take to read before it's indexed by name instead.
const EXTRACT_TIMEOUT: Duration = Duration::from_secs(90);

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
    /// Files that couldn't be read (too slow, or the reader crashed) and
    /// were indexed by name only, since the app started.
    pub unreadable: u64,
}

pub(crate) enum Job {
    Scan,
    /// A folder appeared (moved or unpacked in): queue just its files.
    ScanDir(PathBuf),
    Upsert(PathBuf),
    Remove(PathBuf),
    RemovePrefix(PathBuf),
    Rebuild,
}

pub struct Engine {
    me: Weak<Engine>,
    pub(crate) db: Mutex<Connection>,
    pub(crate) vectors: RwLock<VectorIndex>,
    pub(crate) config: RwLock<EngineConfig>,
    config_path: PathBuf,
    status: Mutex<Status>,
    /// Bumped on every status change; the publisher sends the latest status
    /// when it moves.
    status_version: AtomicU64,
    jobs: Sender<Job>,
    /// The folder watcher and how many times it has been (re)started, so a
    /// slow start can't replace a newer one.
    watcher: Mutex<(u64, Option<watch::Watcher>)>,
    emit: Box<dyn Fn(&Status) + Send + Sync>,
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

        engine.allow_thumbnails(app);
        engine.restart_watcher();

        let worker = engine.clone();
        std::thread::Builder::new()
            .name("winfynd-indexer".into())
            .spawn(move || worker.run(rx))
            .map_err(|e| e.to_string())?;

        let publisher = Arc::downgrade(&engine);
        std::thread::Builder::new()
            .name("winfynd-status".into())
            .spawn(move || publish_status(publisher, STATUS_EVERY))
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
    /// This runs while the app starts up, so it must stay quick: the stored
    /// vectors are loaded later, by the indexer (see `load_index`).
    fn open(
        conn: Connection,
        config: EngineConfig,
        config_path: PathBuf,
        speech_dir: PathBuf,
        emit: impl Fn(&Status) + Send + Sync + 'static,
    ) -> Result<(Arc<Self>, Receiver<Job>), String> {
        let (tx, rx) = mpsc::channel();
        let engine = Arc::new_cyclic(|me| Self {
            me: me.clone(),
            db: Mutex::new(conn),
            vectors: RwLock::new(VectorIndex::new(config.dimensions)),
            config: RwLock::new(config),
            config_path,
            status: Mutex::new(Status {
                state: "loading".into(),
                ollama: "ok".into(),
                ..Status::default()
            }),
            status_version: AtomicU64::new(1),
            jobs: tx,
            watcher: Mutex::new((0, None)),
            emit: Box::new(emit),
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

    /// Change the status. The windows hear about it from `publish_status`,
    /// a few times a second at most, however often this is called.
    fn update_status(&self, f: impl FnOnce(&mut Status)) {
        f(&mut self.status.lock().unwrap());
        self.status_version.fetch_add(1, Ordering::Release);
    }

    /// Send the status to the windows if it changed since `seen`.
    pub(crate) fn publish_status_if_changed(&self, seen: &mut u64) {
        let version = self.status_version.load(Ordering::Acquire);
        if version != *seen {
            *seen = version;
            (self.emit)(&self.status());
        }
    }

    /// Load the stored vectors and counts. Big indexes take a few seconds,
    /// so this happens on the indexer thread; until it's done, searches
    /// match on words only.
    fn load_index(&self) {
        let started = Instant::now();
        let dims = self.config.read().unwrap().dimensions;
        let stored = db::all_vectors(&self.db.lock().unwrap(), dims);
        match stored {
            Ok(stored) => {
                let mut vectors = VectorIndex::new(dims);
                stored.iter().for_each(|(id, v)| vectors.insert(*id, v));
                *self.vectors.write().unwrap() = vectors;
            }
            Err(e) => crate::diag::warn(&format!("couldn't load stored vectors: {e}")),
        }
        let (files, chunks) = db::counts(&self.db.lock().unwrap());
        self.update_status(|s| {
            s.state = "idle".into();
            s.files = files;
            s.chunks = chunks;
        });
        crate::diag::log("INFO", &format!("index loaded: {files} files, {chunks} chunks in {:?}", started.elapsed()));
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

    /// Watch the roots for changes. Starting a watcher can take a while on
    /// big folders, so it happens in the background and never holds up a
    /// window or the indexer.
    fn restart_watcher(&self) {
        let roots = self.config.read().unwrap().roots.clone();
        let jobs = self.jobs.clone();
        let generation = {
            let mut slot = self.watcher.lock().unwrap();
            slot.0 += 1;
            slot.1 = None;
            slot.0
        };
        let me = self.weak_self();
        std::thread::spawn(move || {
            let started = Instant::now();
            let w = watch::Watcher::start(&roots, jobs);
            if started.elapsed() > Duration::from_secs(2) {
                crate::diag::warn(&format!("folder watcher took {:?} to start", started.elapsed()));
            }
            let Some(engine) = me.upgrade() else { return };
            let mut slot = engine.watcher.lock().unwrap();
            if slot.0 == generation {
                slot.1 = w;
            }
        });
    }

    fn weak_self(&self) -> Weak<Self> {
        self.me.clone()
    }

    // ---- background indexer -------------------------------------------------

    fn run(self: Arc<Self>, rx: Receiver<Job>) {
        self.load_index();
        let mut pending = Pending::default();
        loop {
            // Block for the next jobs only when there's nothing left to index.
            let jobs = if pending.is_empty() { next_jobs(&rx, true) } else { next_jobs(&rx, false) };
            let Some(jobs) = jobs else { return };

            // Many jobs can pile up while a file is being read (a folder
            // being unpacked, say). One full scan covers every scan asked for.
            let full_scan = jobs.iter().any(|j| matches!(j, Job::Scan));
            for job in jobs {
                match job {
                    Job::Scan => {}
                    Job::ScanDir(dir) => {
                        if !full_scan {
                            self.queue_files(&mut pending, walk(&dir));
                        }
                    }
                    Job::Upsert(p) => pending.push_front(p),
                    Job::Remove(p) => {
                        pending.remove(&p);
                        self.remove_path(&p);
                    }
                    Job::RemovePrefix(p) => {
                        pending.remove_prefix(&p);
                        self.remove_prefix(&p);
                    }
                    Job::Rebuild => {
                        pending.clear();
                        let dims = self.config.read().unwrap().dimensions;
                        let _ = db::clear(&self.db.lock().unwrap());
                        *self.vectors.write().unwrap() = VectorIndex::new(dims);
                        let _ = self.jobs.send(Job::Scan);
                    }
                }
            }
            if full_scan {
                self.update_status(|s| {
                    s.state = "scanning".into();
                    s.message = None;
                });
                self.refresh_ffmpeg();
                self.queue_files(&mut pending, self.walk_roots());
                self.refresh_ollama_state();
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
                self.index_file_guarded(&p);
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

    /// Queue files found by a walk; media is slow to transcribe, so it goes
    /// after everything else.
    fn queue_files(&self, pending: &mut Pending, files: Vec<PathBuf>) {
        let (media, other): (Vec<_>, Vec<_>) = files.into_iter().partition(|p| is_media(extract::kind_of(p)));
        other.into_iter().chain(media).for_each(|p| pending.push_back(p));
    }

    /// Index one file without letting it take the indexer down: if reading
    /// or storing it panics, it's indexed by name instead and the rest carry on.
    fn index_file_guarded(&self, path: &Path) {
        if std::panic::catch_unwind(AssertUnwindSafe(|| self.index_file(path))).is_ok() {
            return;
        }
        crate::diag::warn(&format!("indexing {} crashed; indexing it by name instead", path.display()));
        self.update_status(|s| s.unreadable += 1);
        let _ = std::panic::catch_unwind(AssertUnwindSafe(|| self.index_path(path, true)));
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
        roots.iter().flat_map(|r| walk(r)).collect()
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
        self.index_path(path, false)
    }

    /// Read, embed and store one file; `name_only` skips reading its contents.
    fn index_path(&self, path: &Path, name_only: bool) {
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
        let model_key = self.model_key(&cfg, kind);
        let key = path.to_string_lossy().to_string();
        if let Ok(Some((s, m, model))) = db::file_stamp(&self.db.lock().unwrap(), &key) {
            // Files stored without vectors are only worth re-reading once
            // Ollama is back; otherwise every rescan re-reads them all.
            let waiting_for_ollama = model == NOT_EMBEDDED && self.status.lock().unwrap().ollama != "ok";
            if s == size && m == mtime && (model == model_key || waiting_for_ollama) && !name_only {
                return;
            }
        }

        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        #[cfg(test)]
        if name.starts_with("crash-for-test") && !name_only {
            panic!("simulated reader crash");
        }
        // Cloud-only OneDrive files would be downloaded just to read them:
        // index those by name until they're on disk.
        let extracted = if name_only || is_cloud_placeholder(&meta) {
            Extracted::NameOnly
        } else if is_media(kind) {
            self.extract_media(&cfg, path, &name, kind)
        } else {
            let (p, images) = (path.to_path_buf(), cfg.index_images);
            match run_with_timeout(EXTRACT_TIMEOUT, move || extract::extract(&p, kind, images)) {
                Ok(x) => x,
                Err(why) => {
                    crate::diag::warn(&format!("reading {} {why}; indexing it by name instead", path.display()));
                    self.update_status(|s| s.unreadable += 1);
                    Extracted::NameOnly
                }
            }
        };

        let (inputs, mut chunks) = plan_chunks(path, &name, kind, extracted);
        let embedded = self.embed_all(&cfg, inputs);
        let stamp = match &embedded {
            Ok(vectors) => {
                for (c, v) in chunks.iter_mut().zip(vectors) {
                    c.vector = Some(v.clone());
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

        let result = db::upsert_file(&mut self.db.lock().unwrap(), &key, &name, kind.as_str(), size, mtime, &stamp, chunks);
        if let Ok((removed, added)) = result {
            let mut v = self.vectors.write().unwrap();
            removed.into_iter().for_each(|id| v.remove(id));
            added.iter().for_each(|(id, vec)| v.insert(*id, vec));
        }
    }

    /// What a file's stored vectors depend on. Media also depends on the
    /// speech model and on whether frames could be read, so installing
    /// either re-reads audio and video on the next scan.
    fn model_key(&self, cfg: &EngineConfig, kind: Kind) -> String {
        let mut key = format!("{}@{}{}", cfg.embed_model, cfg.dimensions, if cfg.index_images { "+img" } else { "" });
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

    fn embed_all(&self, cfg: &EngineConfig, inputs: Vec<EmbedInput>) -> Result<Vec<Vec<f32>>, String> {
        let status = self.status.lock().unwrap().ollama.clone();
        if status != "ok" {
            return Err(self.status.lock().unwrap().message.clone().unwrap_or_else(|| "Ollama unavailable".into()));
        }
        let ollama = self.ollama()?;
        let mut out = Vec::with_capacity(inputs.len());
        for batch in inputs.chunks(EMBED_BATCH) {
            out.extend(ollama.embed(&cfg.embed_model, batch, cfg.dimensions)?);
        }
        Ok(out)
    }
}

/// Every job waiting, or None once the app is shutting down. With `block`,
/// waits for at least one.
fn next_jobs(rx: &Receiver<Job>, block: bool) -> Option<Vec<Job>> {
    let mut jobs = Vec::new();
    if block {
        jobs.push(rx.recv().ok()?);
    }
    while let Ok(j) = rx.try_recv() {
        jobs.push(j);
        if jobs.len() >= 10_000 {
            break;
        }
    }
    Some(jobs)
}

/// Every file under `root` that isn't excluded.
fn walk(root: &Path) -> Vec<PathBuf> {
    let walker = walkdir::WalkDir::new(root).follow_links(false).into_iter();
    walker
        .filter_entry(|e| e.depth() == 0 || !is_excluded(e.path()))
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .collect()
}

/// Send the status to the windows whenever it changes, but no more often
/// than `every`, until the engine is dropped.
fn publish_status(engine: Weak<Engine>, every: Duration) {
    let mut seen = 0;
    loop {
        std::thread::sleep(every);
        let Some(engine) = engine.upgrade() else { return };
        engine.publish_status_if_changed(&mut seen);
    }
}

/// Run `f` on its own thread and give up waiting after `limit`. A reader
/// that panics or hangs on a malformed file then costs that one file, not
/// the whole indexer. A thread that overruns is left to finish on its own.
pub(crate) fn run_with_timeout<T: Send + 'static>(
    limit: Duration,
    f: impl FnOnce() -> T + Send + 'static,
) -> Result<T, &'static str> {
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("winfynd-reader".into())
        .spawn(move || {
            let _ = tx.send(f());
        })
        .map_err(|_| "couldn't start a reader")?;
    match rx.recv_timeout(limit) {
        Ok(v) => Ok(v),
        Err(mpsc::RecvTimeoutError::Timeout) => Err("took too long"),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err("crashed"),
    }
}

/// What to store for a file and what to send to the embedder, in the same order.
fn plan_chunks(path: &Path, name: &str, kind: Kind, extracted: Extracted) -> (Vec<EmbedInput>, Vec<db::NewChunk>) {
    let title = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| name.to_string());
    match extracted {
        Extracted::Text(text) => {
            let inputs = text
                .iter()
                .map(|c| EmbedInput::Document { title: title.clone(), text: c.text.clone() })
                .collect();
            let chunks = text
                .into_iter()
                .map(|c| db::NewChunk { label: c.label, text: Some(c.text), vector: None })
                .collect();
            (inputs, chunks)
        }
        Extracted::Image(b64) => (
            vec![EmbedInput::Image(b64)],
            vec![db::NewChunk { label: None, text: None, vector: None }],
        ),
        Extracted::NameOnly => {
            let (input, chunk) = name_chunk(path, title, kind);
            (vec![input], vec![chunk])
        }
        Extracted::Media { transcript, frames } => {
            // The name first, so the file is found by name even when nothing
            // was said or shown that matches.
            let (input, chunk) = name_chunk(path, title.clone(), kind);
            let mut inputs = vec![input];
            let mut chunks = vec![chunk];
            for c in transcript {
                inputs.push(EmbedInput::Document { title: title.clone(), text: c.text.clone() });
                chunks.push(db::NewChunk { label: c.label, text: Some(c.text), vector: None });
            }
            for (at, b64) in frames {
                inputs.push(EmbedInput::Image(b64));
                chunks.push(db::NewChunk { label: Some(at), text: None, vector: None });
            }
            (inputs, chunks)
        }
    }
}

/// A chunk that stands for the file itself: found by what its name and
/// folder say.
fn name_chunk(path: &Path, title: String, kind: Kind) -> (EmbedInput, db::NewChunk) {
    let folder = path
        .parent()
        .and_then(|p| p.file_name())
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();
    let text = format!("{} file in {}", kind.as_str(), folder);
    (EmbedInput::Document { title, text }, db::NewChunk { label: None, text: None, vector: None })
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
        "Windows", "Program Files", "Program Files (x86)", "site-packages", "bin", "obj",
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
    fn exclusions() {
        assert!(is_excluded(Path::new("/home/u/proj/node_modules/x.js")));
        assert!(is_excluded(Path::new("/home/u/.git/config")));
        assert!(is_excluded(Path::new("/home/u/Docs/~$report.docx")));
        assert!(!is_excluded(Path::new("/home/u/Documents/report.docx")));
    }
}
