//! The search engine: keeps an index of the user's files up to date and
//! answers searches. Files are read, embedded with EmbeddingGemma 2 through
//! the local Ollama server, and stored in SQLite under the app data folder.

pub mod config;
mod db;
mod extract;
pub mod ollama;
pub mod search;
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
use vectors::VectorIndex;

/// Inputs per embedding request.
const EMBED_BATCH: usize = 16;
/// How often the roots are rescanned to catch anything the watcher missed
/// (and to embed files indexed while Ollama was unavailable).
const RESCAN_EVERY: Duration = Duration::from_secs(20 * 60);
/// Stored with each file; a file whose stamp doesn't match is re-embedded.
const NOT_EMBEDDED: &str = "none";

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
        let (engine, rx) = Self::open(conn, config, config_path, move |s| {
            let _ = handle.emit("engine://status", s);
        })?;

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
        emit: impl Fn(&Status) + Send + Sync + 'static,
    ) -> Result<(Arc<Self>, Receiver<Job>), String> {
        let mut vectors = VectorIndex::new(config.dimensions);
        for (id, v) in db::all_vectors(&conn, config.dimensions).map_err(|e| e.to_string())? {
            vectors.insert(id, &v);
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
        } else if old.roots != new.roots {
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
                    for p in self.walk_roots() {
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
        let model_key = format!("{}@{}{}", cfg.embed_model, cfg.dimensions, if cfg.index_images { "+img" } else { "" });
        let key = path.to_string_lossy().to_string();
        if let Ok(Some((s, m, model))) = db::file_stamp(&self.db.lock().unwrap(), &key) {
            if s == size && m == mtime && model == model_key {
                return;
            }
        }

        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let kind = extract::kind_of(path);
        // Cloud-only OneDrive files would be downloaded just to read them:
        // index those by name until they're on disk.
        let extracted = if is_cloud_placeholder(&meta) {
            Extracted::NameOnly
        } else {
            extract::extract(path, kind, cfg.index_images)
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
            // Media and unknown files are found by what their name and folder say.
            let folder = path
                .parent()
                .and_then(|p| p.file_name())
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default();
            let text = format!("{} file in {}", kind.as_str(), folder);
            (
                vec![EmbedInput::Document { title, text: text.clone() }],
                vec![db::NewChunk { label: None, text: None, vector: None }],
            )
        }
    }
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
