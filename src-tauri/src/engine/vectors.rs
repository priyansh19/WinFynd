//! All chunk vectors held in memory as one flat array. A brute-force dot
//! product over ~100k 768-d vectors takes a few milliseconds, which is plenty
//! for a personal index and needs no extra service.
//!
//! Text and pictures (photos, video frames) are ranked apart: a text query
//! lands much closer to any text than to any picture, so one shared ranking
//! would bury every image.

use std::collections::HashMap;

pub struct VectorIndex {
    dims: usize,
    ids: Vec<i64>,
    visual: Vec<bool>,
    data: Vec<f32>,
    pos: HashMap<i64, usize>,
}

impl VectorIndex {
    pub fn new(dims: usize) -> Self {
        Self { dims, ids: Vec::new(), visual: Vec::new(), data: Vec::new(), pos: HashMap::new() }
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.ids.len()
    }

    pub fn insert(&mut self, id: i64, v: &[f32], visual: bool) {
        if v.len() != self.dims {
            return;
        }
        self.remove(id);
        self.pos.insert(id, self.ids.len());
        self.ids.push(id);
        self.visual.push(visual);
        self.data.extend_from_slice(v);
    }

    pub fn remove(&mut self, id: i64) {
        let Some(i) = self.pos.remove(&id) else { return };
        let last = self.ids.len() - 1;
        if i != last {
            let moved = self.ids[last];
            self.ids[i] = moved;
            self.visual[i] = self.visual[last];
            self.pos.insert(moved, i);
            let (head, tail) = self.data.split_at_mut(last * self.dims);
            head[i * self.dims..(i + 1) * self.dims].copy_from_slice(&tail[..self.dims]);
        }
        self.ids.pop();
        self.visual.pop();
        self.data.truncate(last * self.dims);
    }

    /// Best `k_text` text chunks and `k_visual` pictures as (id, cosine,
    /// is visual), best first within each modality.
    pub fn rank(&self, query: &[f32], k_text: usize, k_visual: usize) -> Vec<(i64, f32, bool)> {
        let mut text = Vec::new();
        let mut visual = Vec::new();
        if query.len() == self.dims {
            for ((v, id), is_visual) in self.data.chunks_exact(self.dims).zip(&self.ids).zip(&self.visual) {
                let s = dot(v, query);
                if *is_visual {
                    visual.push((*id, s));
                } else {
                    text.push((*id, s));
                }
            }
        }
        let mut top: Vec<(i64, f32, bool)> = best(text, k_text).into_iter().map(|(id, s)| (id, s, false)).collect();
        top.extend(best(visual, k_visual).into_iter().map(|(id, s)| (id, s, true)));
        top
    }
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn best(mut scored: Vec<(i64, f32)>, k: usize) -> Vec<(i64, f32)> {
    let k = k.min(scored.len());
    if k == 0 {
        return Vec::new();
    }
    scored.select_nth_unstable_by(k - 1, |a, b| b.1.total_cmp(&a.1));
    scored.truncate(k);
    scored.sort_by(|a, b| b.1.total_cmp(&a.1));
    scored
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_remove_and_rank() {
        let mut ix = VectorIndex::new(2);
        ix.insert(1, &[1.0, 0.0], false);
        ix.insert(2, &[0.0, 1.0], false);
        ix.insert(3, &[0.6, 0.8], false);
        let top = |ix: &VectorIndex, k| ix.rank(&[1.0, 0.0], k, k).iter().map(|x| x.0).collect::<Vec<_>>();
        assert_eq!(top(&ix, 2), vec![1, 3]);
        ix.remove(1);
        assert_eq!(ix.len(), 2);
        assert_eq!(top(&ix, 1), vec![3]);
        ix.insert(3, &[0.0, 1.0], false);
        assert_eq!(ix.len(), 2);
        assert_eq!(top(&ix, 5).len(), 2);
    }

    #[test]
    fn modalities_are_ranked_separately() {
        let mut ix = VectorIndex::new(2);
        ix.insert(1, &[1.0, 0.0], false);
        ix.insert(2, &[0.0, 1.0], false);
        ix.insert(10, &[0.3, 0.95], true);
        ix.insert(11, &[0.1, 0.99], true);
        // Removing a text vector must keep the moved one's modality.
        ix.remove(1);
        let r = ix.rank(&[1.0, 0.0], 5, 5);
        assert_eq!(r.iter().filter(|t| !t.2).count(), 1);
        assert_eq!(r.iter().filter(|t| t.2).map(|t| t.0).collect::<Vec<_>>(), vec![10, 11]);
    }
}
