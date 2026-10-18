//! Watches the indexed folders so new, changed, moved and deleted files are
//! picked up within a couple of seconds.

use std::path::PathBuf;
use std::sync::mpsc::Sender;
use std::time::Duration;

use notify_debouncer_full::notify::{self, EventKind, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer_opt, DebounceEventResult, Debouncer, NoCache};

use super::{is_excluded, Job};

pub struct Watcher {
    _debouncer: Debouncer<RecommendedWatcher, NoCache>,
}

impl Watcher {
    /// No file-id cache: on Windows the default one opens every file under
    /// the roots before watching starts (minutes on a big Documents folder,
    /// and it froze the app). Renames show up as a removal plus a new file,
    /// which the indexer handles the same way.
    pub fn start(roots: &[PathBuf], jobs: Sender<Job>) -> Option<Self> {
        let handler = move |result: DebounceEventResult| {
            let Ok(events) = result else { return };
            for event in events {
                for path in &event.paths {
                    if is_excluded(path) {
                        continue;
                    }
                    let job = if path.is_file() {
                        Job::Upsert(path.clone())
                    } else if !path.exists() {
                        Job::Remove(path.clone())
                    } else if matches!(event.kind, EventKind::Create(_)) {
                        // A folder was moved in: pick up its files.
                        Job::ScanDir(path.clone())
                    } else {
                        continue;
                    };
                    let _ = jobs.send(job);
                }
            }
        };
        let mut debouncer =
            new_debouncer_opt(Duration::from_secs(2), None, handler, NoCache, notify::Config::default()).ok()?;
        for root in roots {
            let _ = debouncer.watch(root, RecursiveMode::Recursive);
        }
        Some(Self { _debouncer: debouncer })
    }
}
