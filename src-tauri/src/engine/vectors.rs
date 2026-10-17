//! All chunk vectors held in memory as one flat array. A brute-force dot
//! product over ~100k 768-d vectors takes a few milliseconds, which is plenty
//! for a personal index and needs no extra service.

use std::collections::HashMap;

pub struct VectorIndex {
    dims: usize,
    ids: Vec<i64>,
    data: Vec<f32>,
    pos: HashMap<i64, usize>,
}

impl VectorIndex {
    pub fn new(dims: usize) -> Self {
        Self { dims, ids: Vec::new(), data: Vec::new(), pos: HashMap::new() }
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.ids.len()
    }

    pub fn insert(&mut self, id: i64, v: &[f32]) {
        if v.len() != self.dims {
            return;
        }
        self.remove(id);
        self.pos.insert(id, self.ids.len());
        self.ids.push(id);
        self.data.extend_from_slice(v);
    }

    pub fn remove(&mut self, id: i64) {
        let Some(i) = self.pos.remove(&id) else { return };
        let last = self.ids.len() - 1;
        if i != last {
            let moved = self.ids[last];
            self.ids[i] = moved;
            self.pos.insert(moved, i);
            let (head, tail) = self.data.split_at_mut(last * self.dims);
            head[i * self.dims..(i + 1) * self.dims].copy_from_slice(&tail[..self.dims]);
        }
        self.ids.pop();
        self.data.truncate(last * self.dims);
    }

    /// Best `k` ids by dot product (cosine, since vectors are unit length).
    pub fn top_k(&self, query: &[f32], k: usize) -> Vec<(i64, f32)> {
        if query.len() != self.dims || k == 0 {
            return Vec::new();
        }
        let mut scored: Vec<(i64, f32)> = self
            .data
            .chunks_exact(self.dims)
            .zip(&self.ids)
            .map(|(v, id)| (*id, v.iter().zip(query).map(|(a, b)| a * b).sum()))
            .collect();
        let k = k.min(scored.len());
        if k == 0 {
            return scored;
        }
        scored.select_nth_unstable_by(k - 1, |a, b| b.1.total_cmp(&a.1));
        scored.truncate(k);
        scored.sort_by(|a, b| b.1.total_cmp(&a.1));
        scored
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_remove_and_rank() {
        let mut ix = VectorIndex::new(2);
        ix.insert(1, &[1.0, 0.0]);
        ix.insert(2, &[0.0, 1.0]);
        ix.insert(3, &[0.6, 0.8]);
        assert_eq!(ix.top_k(&[1.0, 0.0], 2).iter().map(|x| x.0).collect::<Vec<_>>(), vec![1, 3]);
        ix.remove(1);
        assert_eq!(ix.len(), 2);
        assert_eq!(ix.top_k(&[1.0, 0.0], 1)[0].0, 3);
        ix.insert(3, &[0.0, 1.0]);
        assert_eq!(ix.len(), 2);
        assert_eq!(ix.top_k(&[1.0, 0.0], 5).len(), 2);
    }
}
