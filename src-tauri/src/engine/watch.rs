//! Watches the indexed folders so new, changed, moved and deleted files are
//! picked up within a couple of seconds.

use std::path::PathBuf;
use std::sync::mpsc::Sender;
use std::time::Duration;

use notify_debouncer_full::notify::{EventKind, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};

use super::{is_excluded, Job};

pub struct Watcher {
    _debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
}

impl Watcher {
    pub fn start(roots: &[PathBuf], jobs: Sender<Job>) -> Option<Self> {
        let mut debouncer = new_debouncer(Duration::from_secs(2), None, move |result: DebounceEventResult| {
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
                        // A folder was moved in: rescan to pick up its files.
                        Job::Scan
                    } else {
                        continue;
                    };
                    let _ = jobs.send(job);
                }
            }
        })
        .ok()?;
        for root in roots {
            let _ = debouncer.watch(root, RecursiveMode::Recursive);
        }
        Some(Self { _debouncer: debouncer })
    }
}
