//! EmbeddingGemma 2 run by WinFynd itself, so searching by meaning doesn't
//! need Ollama. The model files (GGUF) are downloaded once from Hugging Face
//! into the app data folder and run by llama.cpp's server, which ships with
//! WinFynd. The server only listens on 127.0.0.1, starts when there's
//! something to embed, runs below normal priority on half the cores, and
//! quits after a few idle minutes to give its memory back.

use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};

use super::ollama::{normalize, EmbedInput, InstalledModel};

#[cfg(windows)]
pub const SERVER_EXE: &str = "llama-server.exe";
#[cfg(not(windows))]
pub const SERVER_EXE: &str = "llama-server";

/// ggml-org's conversion of google/embeddinggemma-2.
const REPO: &str = "https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/resolve/main";
/// The 270M text core; every size needs it. Q8_0 gives nearly the same vectors as BF16.
const TEXT_FILE: &str = "embeddinggemma-2-Q8_0.gguf";
/// The vision and audio encoders, for photos and video frames.
const MEDIA_FILE: &str = "mmproj-embeddinggemma-2-Q8_0.gguf";
/// Sizes shown before a download starts.
const TEXT_BYTES: u64 = 310_000_000;
const MEDIA_BYTES: u64 = 555_000_000;

/// The server quits after this long without anything to embed.
const IDLE: Duration = Duration::from_secs(5 * 60);
/// Longest wait for the server to load the model.
const STARTUP: Duration = Duration::from_secs(120);
/// Tokens per input. Chunks are far shorter; this also bounds memory.
const CONTEXT: u32 = 2048;
/// Inputs past this many characters are cut, so one can't exceed `CONTEXT`.
const MAX_CHARS: usize = 6000;

/// Whether a model name (Ollama style tag) reads photos. The 270m tag is
/// the text core alone; 440m and the full model both use the media file.
pub fn reads_images(tag: &str) -> bool {
    !tag.ends_with(":270m")
}

fn files_for(tag: &str) -> Vec<(&'static str, u64)> {
    let mut files = vec![(TEXT_FILE, TEXT_BYTES)];
    if reads_images(tag) {
        files.push((MEDIA_FILE, MEDIA_BYTES));
    }
    files
}

pub struct LocalModel {
    /// llama-server and its DLLs; None when this build doesn't carry them.
    server_exe: Option<PathBuf>,
    /// Where the model files are kept.
    dir: PathBuf,
    /// Where the server writes its log, replaced on each start.
    log: Option<PathBuf>,
    server: Mutex<Option<Server>>,
    downloading: AtomicBool,
    /// Set when the server wouldn't start with the photo encoders, so it runs
    /// text only until WinFynd restarts rather than not at all.
    no_media: AtomicBool,
    http: reqwest::blocking::Client,
    /// A server already running, used instead of starting one (tests).
    #[cfg(test)]
    attached: Option<String>,
}

struct Server {
    child: Child,
    base: String,
    images: bool,
    last_used: Instant,
    /// Closing it ends the server, even if WinFynd itself crashes.
    #[cfg(windows)]
    _job: Option<job::Job>,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl LocalModel {
    pub fn new(runtime_dir: Option<PathBuf>, dir: PathBuf, log: Option<PathBuf>) -> Arc<Self> {
        let server_exe = runtime_dir.map(|d| d.join(SERVER_EXE)).filter(|p| p.is_file());
        let http = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default();
        let me = Arc::new(Self {
            server_exe,
            dir,
            log,
            server: Mutex::new(None),
            downloading: AtomicBool::new(false),
            no_media: AtomicBool::new(false),
            http,
            #[cfg(test)]
            attached: None,
        });
        let weak = Arc::downgrade(&me);
        std::thread::Builder::new()
            .name("winfynd-model-idle".into())
            .spawn(move || stop_when_idle(weak))
            .ok();
        me
    }

    /// Use a server that's already running at `base`, as if the model files
    /// were downloaded into `dir`.
    #[cfg(test)]
    pub fn attached(dir: PathBuf, base: String) -> Arc<Self> {
        fs::create_dir_all(&dir).unwrap();
        for (f, _) in files_for("embeddinggemma-2") {
            fs::write(dir.join(f), b"stand-in").unwrap();
        }
        Arc::new(Self {
            server_exe: Some(dir.join(SERVER_EXE)),
            dir,
            log: None,
            server: Mutex::new(None),
            downloading: AtomicBool::new(false),
            no_media: AtomicBool::new(false),
            http: reqwest::blocking::Client::new(),
            attached: Some(base),
        })
    }

    pub fn has_runtime(&self) -> bool {
        self.server_exe.is_some()
    }

    fn path(&self, file: &str) -> PathBuf {
        self.dir.join(file)
    }

    pub fn is_installed(&self, tag: &str) -> bool {
        files_for(tag).iter().all(|(f, _)| self.path(f).is_file())
    }

    pub fn is_downloading(&self) -> bool {
        self.downloading.load(Ordering::SeqCst)
    }

    /// The model sizes on disk, named like Ollama's tags so the windows can
    /// treat both the same way.
    pub fn installed(&self) -> Vec<InstalledModel> {
        let size = |f: &str| fs::metadata(self.path(f)).map(|m| m.len()).unwrap_or(0);
        let mut out = Vec::new();
        if self.is_installed("embeddinggemma-2:270m") {
            out.push(InstalledModel { name: "embeddinggemma-2:270m".into(), size: size(TEXT_FILE) });
        }
        if self.is_installed("embeddinggemma-2") {
            let both = size(TEXT_FILE) + size(MEDIA_FILE);
            out.push(InstalledModel { name: "embeddinggemma-2".into(), size: both });
            out.push(InstalledModel { name: "embeddinggemma-2:440m".into(), size: both });
        }
        out
    }

    /// Download what `tag` needs, reporting (done, total) bytes. Unfinished
    /// files are resumed. Only one download runs at a time.
    pub fn download(&self, tag: &str, mut progress: impl FnMut(u64, u64)) -> Result<(), String> {
        if self.downloading.swap(true, Ordering::SeqCst) {
            return Err("The search model is already downloading".into());
        }
        let result = self.download_files(tag, &mut progress);
        self.downloading.store(false, Ordering::SeqCst);
        result
    }

    fn download_files(&self, tag: &str, progress: &mut impl FnMut(u64, u64)) -> Result<(), String> {
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let files = files_for(tag);
        let mut sizes: Vec<u64> = files.iter().map(|(f, approx)| fs::metadata(self.path(f)).map(|m| m.len()).unwrap_or(*approx)).collect();
        let mut finished = 0u64;
        for (i, (file, _)) in files.iter().enumerate() {
            let target = self.path(file);
            if target.is_file() {
                finished += sizes[i];
                continue;
            }
            let part = self.path(&format!("{file}.part"));
            let have = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
            let mut req = self.http.get(format!("{REPO}/{file}")).timeout(Duration::from_secs(6 * 3600));
            if have > 0 {
                req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
            }
            let mut resp = req.send().map_err(|e| format!("Couldn't reach Hugging Face: {e}"))?;
            if !resp.status().is_success() {
                return Err(format!("Hugging Face answered {} for {file}", resp.status()));
            }
            // 206 resumes the partial file; anything else starts it over.
            let resumed = resp.status() == reqwest::StatusCode::PARTIAL_CONTENT;
            let mut done = if resumed { have } else { 0 };
            if let Some(len) = resp.content_length() {
                sizes[i] = done + len;
            }
            let total = |sizes: &[u64]| sizes.iter().sum::<u64>();
            let mut out = fs::OpenOptions::new()
                .create(true)
                .write(true)
                .append(resumed)
                .truncate(!resumed)
                .open(&part)
                .map_err(|e| e.to_string())?;
            let mut buf = vec![0u8; 1 << 16];
            let mut reported = Instant::now();
            loop {
                let n = resp.read(&mut buf).map_err(|e| format!("The download stopped: {e}"))?;
                if n == 0 {
                    break;
                }
                out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
                done += n as u64;
                if reported.elapsed() >= Duration::from_millis(250) {
                    reported = Instant::now();
                    progress(finished + done, total(&sizes));
                }
            }
            out.flush().map_err(|e| e.to_string())?;
            drop(out);
            if done < sizes[i] {
                return Err(format!("The download of {file} ended early; try again to resume it"));
            }
            fs::rename(&part, &target).map_err(|e| e.to_string())?;
            finished += done;
            progress(finished, total(&sizes));
        }
        Ok(())
    }

    /// Unit-length vectors, one per input. Photos fail when `tag` is the
    /// text-only model; the caller retries them one at a time.
    pub fn embed(&self, tag: &str, inputs: &[&EmbedInput], dimensions: usize) -> Result<Vec<Vec<f32>>, String> {
        let (base, images) = self.running(tag)?;
        // Answered here, so the caller's retry of each photo costs nothing.
        if !images && inputs.iter().any(|i| i.is_image()) {
            return Err("this size of the model reads text only".into());
        }
        #[derive(Deserialize)]
        struct Item {
            index: usize,
            embedding: Vec<f32>,
        }
        #[derive(Deserialize)]
        struct Resp {
            data: Vec<Item>,
        }
        let body = json!({
            "input": inputs.iter().map(|i| to_json(i)).collect::<Vec<_>>(),
            "encoding_format": "float",
        });
        let resp = self
            .http
            .post(format!("{base}/v1/embeddings"))
            .timeout(Duration::from_secs(600))
            .json(&body)
            .send()
            .map_err(|e| format!("The search model stopped: {e}"))?;
        self.touch();
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().unwrap_or_default();
            return Err(format!("The search model failed ({status}): {}", text.chars().take(300).collect::<String>()));
        }
        let mut parsed: Resp = resp.json().map_err(|e| e.to_string())?;
        if parsed.data.len() != inputs.len() {
            return Err("The search model returned the wrong number of vectors".into());
        }
        parsed.data.sort_by_key(|d| d.index);
        Ok(parsed
            .data
            .into_iter()
            .map(|d| {
                let mut v = d.embedding;
                v.truncate(dimensions);
                normalize(v)
            })
            .collect())
    }

    fn touch(&self) {
        if let Some(s) = self.server.lock().unwrap().as_mut() {
            s.last_used = Instant::now();
        }
    }

    /// The address of a server that's ready for `tag`, starting one if
    /// needed, and whether it reads photos.
    fn running(&self, tag: &str) -> Result<(String, bool), String> {
        #[cfg(test)]
        if let Some(base) = &self.attached {
            return Ok((base.clone(), reads_images(tag)));
        }
        let exe = self.server_exe.clone().ok_or(
            "This copy of WinFynd doesn't include its model engine. Reinstall WinFynd, or switch to Ollama on the Models page.",
        )?;
        if !self.is_installed(tag) {
            return Err(if self.is_downloading() {
                "The search model is still downloading".into()
            } else {
                "Download EmbeddingGemma 2 on the Models page to search by meaning.".into()
            });
        }
        let images = reads_images(tag) && !self.no_media.load(Ordering::SeqCst);
        let mut slot = self.server.lock().unwrap();
        if let Some(s) = slot.as_mut() {
            let alive = matches!(s.child.try_wait(), Ok(None));
            if alive && s.images == images {
                s.last_used = Instant::now();
                return Ok((s.base.clone(), images));
            }
            if !alive {
                crate::diag::warn("the search model's engine stopped; starting it again");
            }
        }
        // Dropping the old one stops it.
        *slot = None;
        let server = match self.start(&exe, images) {
            Ok(s) => s,
            // Text search matters most: without the photo encoders rather than not at all.
            Err(e) if images => {
                crate::diag::warn(&format!("the search model wouldn't start with photos ({e}); starting it for text only"));
                self.no_media.store(true, Ordering::SeqCst);
                self.start(&exe, false)?
            }
            Err(e) => return Err(e),
        };
        let (base, images) = (server.base.clone(), server.images);
        *slot = Some(server);
        Ok((base, images))
    }

    fn start(&self, exe: &Path, images: bool) -> Result<Server, String> {
        let port = TcpListener::bind("127.0.0.1:0")
            .and_then(|l| l.local_addr())
            .map(|a| a.port())
            .map_err(|e| e.to_string())?;
        let threads = std::thread::available_parallelism().map(|n| (n.get() / 2).max(1)).unwrap_or(2);
        let context = if images { CONTEXT * 2 } else { CONTEXT }.to_string();
        let mut cmd = Command::new(exe);
        cmd.arg("-m").arg(self.path(TEXT_FILE));
        if images {
            cmd.arg("--mmproj").arg(self.path(MEDIA_FILE));
        }
        cmd.args(["--embeddings", "--pooling", "mean"])
            .args(["-c", &context, "-b", &context, "-ub", &context])
            .args(["--parallel", "1", "--threads", &threads.to_string()])
            .args(["--host", "127.0.0.1", "--port", &port.to_string()])
            .stdin(Stdio::null());
        // Its DLLs sit next to it.
        if let Some(dir) = exe.parent() {
            cmd.current_dir(dir);
        }
        let log = self.log.as_ref().and_then(|p| fs::File::create(p).ok());
        match log.as_ref().and_then(|f| f.try_clone().ok()) {
            Some(err) => {
                cmd.stdout(Stdio::from(log.unwrap())).stderr(Stdio::from(err));
            }
            None => {
                cmd.stdout(Stdio::null()).stderr(Stdio::null());
            }
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
            cmd.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
        }
        let child = cmd.spawn().map_err(|e| format!("Couldn't start the search model: {e}"))?;
        #[cfg(windows)]
        let job = job::Job::kill_on_close(&child);
        let mut server = Server {
            child,
            base: format!("http://127.0.0.1:{port}"),
            images,
            last_used: Instant::now(),
            #[cfg(windows)]
            _job: job,
        };

        // Loading takes a few seconds; /health answers 503 until it's ready.
        let started = Instant::now();
        loop {
            if let Ok(Some(code)) = server.child.try_wait() {
                return Err(format!("The search model's engine closed while loading ({code}). See llama-server.log in the WinFynd log folder."));
            }
            let ready = self
                .http
                .get(format!("{}/health", server.base))
                .timeout(Duration::from_secs(2))
                .send()
                .is_ok_and(|r| r.status().is_success());
            if ready {
                server.last_used = Instant::now();
                return Ok(server);
            }
            if started.elapsed() > STARTUP {
                return Err("The search model took too long to load".into());
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    }

    fn stop_if_idle(&self) {
        let mut slot = self.server.lock().unwrap();
        if slot.as_ref().is_some_and(|s| s.last_used.elapsed() > IDLE) {
            *slot = None;
        }
    }
}

fn stop_when_idle(model: Weak<LocalModel>) {
    loop {
        std::thread::sleep(Duration::from_secs(30));
        match model.upgrade() {
            Some(m) => m.stop_if_idle(),
            None => return,
        }
    }
}

fn to_json(input: &EmbedInput) -> Value {
    // Prompt formats from the EmbeddingGemma 2 model card; media takes no prefix.
    let cut = |s: String| if s.len() > MAX_CHARS { s.chars().take(MAX_CHARS).collect() } else { s };
    match input {
        EmbedInput::Query(q) => json!(cut(format!("task: search result | query: {q}"))),
        EmbedInput::Document { title, text } => json!(cut(format!("title: {title} | text: {text}"))),
        EmbedInput::Image(b64) => {
            let mime = if b64.starts_with("iVBOR") { "image/png" } else { "image/jpeg" };
            json!({ "content": [{ "type": "image_url", "image_url": { "url": format!("data:{mime};base64,{b64}") } }] })
        }
    }
}

#[cfg(windows)]
mod job {
    //! A Windows job object that ends the model server when WinFynd ends,
    //! however it ends, so a crash can't leave the server holding memory.

    use std::os::windows::io::AsRawHandle;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    pub struct Job(HANDLE);

    // The handle is only closed, once, on drop.
    unsafe impl Send for Job {}

    impl Job {
        pub fn kill_on_close(child: &std::process::Child) -> Option<Job> {
            unsafe {
                let job = Job(CreateJobObjectW(None, PCWSTR::null()).ok()?);
                let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const std::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
                .ok()?;
                AssignProcessToJobObject(job.0, HANDLE(child.as_raw_handle())).ok()?;
                Some(job)
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_and_files() {
        assert_eq!(files_for("embeddinggemma-2:270m").len(), 1);
        assert_eq!(files_for("embeddinggemma-2").len(), 2);
        assert_eq!(files_for("embeddinggemma-2:440m").len(), 2);
    }

    #[test]
    fn prompts_and_pictures() {
        assert_eq!(to_json(&EmbedInput::Query("tax".into())), json!("task: search result | query: tax"));
        let long = to_json(&EmbedInput::Document { title: "a".into(), text: "x".repeat(MAX_CHARS * 2) });
        assert_eq!(long.as_str().unwrap().len(), MAX_CHARS);
        let png = to_json(&EmbedInput::Image("iVBORw0KGgo".into()));
        assert!(png["content"][0]["image_url"]["url"].as_str().unwrap().starts_with("data:image/png;base64,"));
    }

    #[test]
    fn missing_engine_says_so() {
        let dir = crate::engine::e2e_tests::temp_dir("local-model");
        let m = LocalModel::new(None, dir, None);
        assert!(!m.has_runtime());
        let err = m.embed("embeddinggemma-2", &[&EmbedInput::Query("x".into())], 768).unwrap_err();
        assert!(err.contains("model engine"), "{err}");
    }
}
