//! Diagnostics that make a hang or crash explain itself: a small log file,
//! a panic hook that writes to it, and a watchdog that notices when the
//! window thread stops answering (what Windows reports as "Not Responding").

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Runtime};

/// The log is started afresh once it grows past this; the previous one is kept.
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;
/// How often the watchdog checks on the window thread.
const PING_EVERY: Duration = Duration::from_secs(1);
/// Longer than this without an answer is logged as a stall. Windows shows
/// "Not Responding" after five seconds.
pub const STALL_AFTER: Duration = Duration::from_secs(2);

static LOG: OnceLock<Mutex<PathBuf>> = OnceLock::new();

/// Start logging to `dir/winfynd.log` and record panics there.
pub fn init(dir: &Path) {
    let _ = fs::create_dir_all(dir);
    let _ = LOG.set(Mutex::new(dir.join("winfynd.log")));
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let name = thread.name().unwrap_or("unnamed");
        log("PANIC", &format!("thread '{name}': {info}"));
        previous(info);
    }));
    log("INFO", &format!("WinFynd {} started", env!("CARGO_PKG_VERSION")));
}

pub fn log(level: &str, message: &str) {
    let Some(path) = LOG.get() else {
        if cfg!(debug_assertions) {
            eprintln!("[{level}] {message}");
        }
        return;
    };
    let path = path.lock().unwrap_or_else(|e| e.into_inner());
    if fs::metadata(&*path).map(|m| m.len() > MAX_LOG_BYTES).unwrap_or(false) {
        let _ = fs::rename(&*path, path.with_extension("old.log"));
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&*path) {
        let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(f, "{secs} {level} {message}");
    }
}

pub fn warn(message: &str) {
    log("WARN", message);
}

/// The longest the window thread has gone without answering, and how many
/// times it went past `STALL_AFTER`.
#[derive(Default)]
pub struct Watchdog {
    worst_ms: AtomicU64,
    stalls: AtomicU64,
}

impl Watchdog {
    /// Record how long one ping took to be answered.
    fn record(&self, waited: Duration, context: impl FnOnce() -> String) {
        self.worst_ms.fetch_max(waited.as_millis() as u64, Ordering::Relaxed);
        if waited >= STALL_AFTER {
            self.stalls.fetch_add(1, Ordering::Relaxed);
            warn(&format!("window thread blocked for {:.1}s ({})", waited.as_secs_f32(), context()));
        }
    }
}

/// Keep pinging the window thread from the background. `context` describes
/// what the app was doing, for the log line written when a ping is late.
pub fn watch_main_thread<R: Runtime>(
    app: AppHandle<R>,
    context: impl Fn() -> String + Send + 'static,
) -> Arc<Watchdog> {
    let dog = Arc::new(Watchdog::default());
    let d = dog.clone();
    let _ = std::thread::Builder::new().name("winfynd-watchdog".into()).spawn(move || loop {
        std::thread::sleep(PING_EVERY);
        let (tx, rx) = std::sync::mpsc::channel();
        let sent = Instant::now();
        if app.run_on_main_thread(move || {
            let _ = tx.send(());
        }).is_err() {
            return;
        }
        // Note a stall straight away, in case it never ends and the app is
        // killed, then wait for the answer to log how long it lasted.
        if rx.recv_timeout(STALL_AFTER).is_err() {
            warn(&format!("window thread not answering ({})", context()));
            if rx.recv().is_err() {
                return;
            }
        }
        d.record(sent.elapsed(), &context);
    });
    dog
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_only_long_waits_as_stalls() {
        let dog = Watchdog::default();
        dog.record(Duration::from_millis(30), || unreachable!());
        assert_eq!(dog.stalls.load(Ordering::Relaxed), 0);
        dog.record(STALL_AFTER + Duration::from_millis(1), || "indexing".into());
        assert_eq!(dog.stalls.load(Ordering::Relaxed), 1);
        assert!(dog.worst_ms.load(Ordering::Relaxed) > STALL_AFTER.as_millis() as u64);
    }
}
