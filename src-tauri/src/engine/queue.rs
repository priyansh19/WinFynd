//! Files waiting to be indexed, in order, with no duplicates. A full scan
//! queues every file under the roots, so membership checks must stay O(1):
//! a plain list made each scan quadratic in the number of files.

use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};

#[derive(Default)]
pub struct Pending {
    order: VecDeque<PathBuf>,
    queued: HashSet<PathBuf>,
}

impl Pending {
    pub fn len(&self) -> usize {
        self.order.len()
    }

    pub fn is_empty(&self) -> bool {
        self.order.is_empty()
    }

    /// Queue at the end, unless it's already waiting.
    pub fn push_back(&mut self, p: PathBuf) {
        if self.queued.insert(p.clone()) {
            self.order.push_back(p);
        }
    }

    /// Queue next in line, unless it's already waiting.
    pub fn push_front(&mut self, p: PathBuf) {
        if self.queued.insert(p.clone()) {
            self.order.push_front(p);
        }
    }

    pub fn pop_front(&mut self) -> Option<PathBuf> {
        let p = self.order.pop_front()?;
        self.queued.remove(&p);
        Some(p)
    }

    pub fn remove(&mut self, p: &Path) {
        if self.queued.remove(p) {
            self.order.retain(|q| q != p);
        }
    }

    pub fn remove_prefix(&mut self, prefix: &Path) {
        self.order.retain(|q| !q.starts_with(prefix));
        self.queued.retain(|q| !q.starts_with(prefix));
    }

    pub fn clear(&mut self) {
        self.order.clear();
        self.queued.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn keeps_order_and_skips_duplicates() {
        let mut q = Pending::default();
        q.push_back("a".into());
        q.push_back("b".into());
        q.push_back("a".into());
        q.push_front("c".into());
        q.push_front("b".into());
        assert_eq!(q.len(), 3);
        q.remove(Path::new("a"));
        assert_eq!(q.pop_front(), Some("c".into()));
        assert_eq!(q.pop_front(), Some("b".into()));
        assert!(q.is_empty());
        q.push_back("b".into());
        assert_eq!(q.len(), 1, "a popped path can be queued again");
    }

    /// Eval: queueing a big folder twice (a rescan while the first pass is
    /// still running) must stay fast.
    #[test]
    fn queues_two_hundred_thousand_files_quickly() {
        let paths: Vec<PathBuf> = (0..200_000).map(|i| PathBuf::from(format!("C:/Users/u/Documents/f{i}.txt"))).collect();
        let started = Instant::now();
        let mut q = Pending::default();
        for _ in 0..2 {
            paths.iter().cloned().for_each(|p| q.push_back(p));
        }
        assert_eq!(q.len(), paths.len());
        assert!(started.elapsed() < Duration::from_secs(3), "took {:?}", started.elapsed());
    }
}
