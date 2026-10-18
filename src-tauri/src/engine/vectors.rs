//! All chunk vectors held in memory as one flat array. A brute-force dot
//! product over ~100k 768-d vectors takes a few milliseconds, which is plenty
//! for a personal index and needs no extra service.
//!
//! Each vector is kept as 8-bit integers plus one scale, a quarter of the
//! memory of 32-bit floats (a million 768-d chunks: ~0.8 GB instead of 3 GB).
//! That moves a cosine by about 0.005 at most, far below what ranking uses.
//! The stored copies in SQLite stay full precision.
//!
//! Text and pictures (photos, video frames) are ranked apart: a text query
//! lands much closer to any text than to any picture, so one shared ranking
//! would bury every image.

use std::collections::HashMap;

pub struct VectorIndex {
    dims: usize,
    ids: Vec<i64>,
    visual: Vec<bool>,
    data: Vec<i8>,
    /// Per vector: data × scale = the original values.
    scales: Vec<f32>,
    pos: HashMap<i64, usize>,
}

impl VectorIndex {
    pub fn new(dims: usize) -> Self {
        Self { dims, ids: Vec::new(), visual: Vec::new(), data: Vec::new(), scales: Vec::new(), pos: HashMap::new() }
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
        let max = v.iter().fold(0f32, |m, x| m.max(x.abs()));
        let scale = if max > 0.0 { max / 127.0 } else { 1.0 };
        self.data.extend(v.iter().map(|x| (x / scale).round() as i8));
        self.scales.push(scale);
    }

    pub fn remove(&mut self, id: i64) {
        let Some(i) = self.pos.remove(&id) else { return };
        let last = self.ids.len() - 1;
        if i != last {
            let moved = self.ids[last];
            self.ids[i] = moved;
            self.visual[i] = self.visual[last];
            self.scales[i] = self.scales[last];
            self.pos.insert(moved, i);
            let (head, tail) = self.data.split_at_mut(last * self.dims);
            head[i * self.dims..(i + 1) * self.dims].copy_from_slice(&tail[..self.dims]);
        }
        self.ids.pop();
        self.visual.pop();
        self.scales.pop();
        self.data.truncate(last * self.dims);
    }

    /// Best `k_text` text chunks and `k_visual` pictures as (id, cosine,
    /// is visual), best first within each modality.
    pub fn rank(&self, query: &[f32], k_text: usize, k_visual: usize) -> Vec<(i64, f32, bool)> {
        let mut text = Vec::new();
        let mut visual = Vec::new();
        if query.len() == self.dims {
            let rows = self.data.chunks_exact(self.dims).zip(&self.scales);
            for (((v, scale), id), is_visual) in rows.zip(&self.ids).zip(&self.visual) {
                let s = dot(v, query) * scale;
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

fn dot(a: &[i8], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| *x as f32 * y).sum()
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
    fn eight_bit_scores_stay_close_to_full_precision() {
        let dims = 768;
        let unit = |seed: u32| {
            let v: Vec<f32> = (0..dims).map(|i| (((i as u32).wrapping_mul(2654435761) ^ seed) % 1000) as f32 / 500.0 - 1.0).collect();
            let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
            v.into_iter().map(|x| x / n).collect::<Vec<f32>>()
        };
        let q = unit(7);
        let mut ix = VectorIndex::new(dims);
        for id in 0..50 {
            ix.insert(id, &unit(id as u32 * 31 + 1), false);
        }
        for (id, score, _) in ix.rank(&q, 50, 0) {
            let exact: f32 = unit(id as u32 * 31 + 1).iter().zip(&q).map(|(a, b)| a * b).sum();
            assert!((score - exact).abs() < 0.005, "{score} vs {exact}");
        }
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
