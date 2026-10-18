//! SQLite store: one row per file, one per chunk (a page, slide, sheet or
//! window of text, or a whole image), a vector per chunk, a full-text index
//! for words (stemmed, so "invoices" finds "invoice") and a trigram index on
//! file names and paths for partial names ("budg" finds "Q3_budget_v2.xlsx").

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

pub struct FileRow {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub kind: String,
    pub size: i64,
    pub mtime: i64,
}

pub struct ChunkRow {
    pub label: Option<String>,
    pub text: Option<String>,
    /// A picture (photo or video frame) rather than text or a file name.
    pub visual: bool,
}

/// Words are folded to lowercase without accents, then stemmed. Porter is an
/// English stemmer; on other languages it only trims common endings, the same
/// way on both sides, so words still match themselves.
const FTS_TOKENIZER: &str = "tokenize = 'porter unicode61 remove_diacritics 2'";

/// The name column carries the name split into words too, so "taxReturn2025"
/// is found by "return".
fn insert_fts(conn: &Connection, chunk_id: i64, name: Option<&str>, text: Option<&str>) -> rusqlite::Result<()> {
    let name = name.map(|n| format!("{n} {}", super::name_words(n))).unwrap_or_default();
    let text = text.unwrap_or("");
    if !name.is_empty() || !text.is_empty() {
        conn.execute("INSERT INTO fts (name, text, chunk_id) VALUES (?1, ?2, ?3)", params![name, text, chunk_id])?;
    }
    Ok(())
}

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS files (
           id INTEGER PRIMARY KEY,
           path TEXT NOT NULL UNIQUE,
           name TEXT NOT NULL,
           kind TEXT NOT NULL,
           size INTEGER NOT NULL,
           mtime INTEGER NOT NULL,
           indexed_at INTEGER NOT NULL,
           model TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS chunks (
           id INTEGER PRIMARY KEY,
           file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
           ord INTEGER NOT NULL,
           label TEXT,
           text TEXT,
           vector BLOB
         );
         CREATE INDEX IF NOT EXISTS chunks_file ON chunks(file_id);
         CREATE INDEX IF NOT EXISTS files_mtime ON files(mtime);",
    )?;
    // Indexes built with the old unstemmed tokenizer are rebuilt from the
    // stored chunks; nothing has to be re-read or re-embedded for this.
    let fts_sql: Option<String> = conn
        .query_row("SELECT sql FROM sqlite_master WHERE name = 'fts'", [], |r| r.get(0))
        .optional()?;
    if fts_sql.as_deref().is_none_or(|sql| !sql.contains("porter")) {
        conn.execute_batch(&format!(
            "DROP TABLE IF EXISTS fts;
             CREATE VIRTUAL TABLE fts USING fts5(name, text, chunk_id UNINDEXED, {FTS_TOKENIZER});"
        ))?;
        let rows: Vec<(i64, i64, String, Option<String>)> = {
            let mut stmt = conn.prepare(
                "SELECT c.id, c.ord, f.name, c.text FROM chunks c JOIN files f ON f.id = c.file_id",
            )?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
            rows.collect::<Result<_, _>>()?
        };
        let tx = conn.unchecked_transaction()?;
        for (id, ord, name, text) in rows {
            insert_fts(&tx, id, if ord == 0 { Some(&name) } else { None }, text.as_deref())?;
        }
        tx.commit()?;
    }
    let has_names: bool = conn.prepare("SELECT 1 FROM sqlite_master WHERE name = 'fts_names'")?.exists([])?;
    if !has_names {
        conn.execute_batch(
            "CREATE VIRTUAL TABLE fts_names USING fts5(name, path, file_id UNINDEXED, tokenize = 'trigram');
             INSERT INTO fts_names (name, path, file_id) SELECT name, path, id FROM files;",
        )?;
    }
    let has_visual: bool = conn
        .prepare("SELECT 1 FROM pragma_table_info('chunks') WHERE name = 'visual'")?
        .exists([])?;
    if !has_visual {
        // Older indexes: pictures are the chunks of images and video frames
        // that carry no text. Those files are re-read on the next scan anyway
        // (the chunking version is part of their stamp).
        conn.execute_batch(
            "ALTER TABLE chunks ADD COLUMN visual INTEGER NOT NULL DEFAULT 0;
             UPDATE chunks SET visual = 1 WHERE text IS NULL AND file_id IN (SELECT id FROM files WHERE kind IN ('image', 'video'))
               AND (label IS NOT NULL OR file_id IN (SELECT id FROM files WHERE kind = 'image'));",
        )?;
    }
    Ok(conn)
}

/// The size and mtime last indexed for `path`, with the model used.
pub fn file_stamp(conn: &Connection, path: &str) -> rusqlite::Result<Option<(i64, i64, String)>> {
    conn.query_row("SELECT size, mtime, model FROM files WHERE path = ?1", [path], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?))
    })
    .optional()
}

/// Chunk ids belonging to `path`, so the in-memory vectors can drop them.
pub fn chunk_ids_for(conn: &Connection, path: &str) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare("SELECT c.id FROM chunks c JOIN files f ON f.id = c.file_id WHERE f.path = ?1")?;
    let ids = stmt.query_map([path], |r| r.get(0))?.collect();
    ids
}

pub fn remove_file(conn: &Connection, path: &str) -> rusqlite::Result<Vec<i64>> {
    let ids = chunk_ids_for(conn, path)?;
    for id in &ids {
        conn.execute("DELETE FROM fts WHERE chunk_id = ?1", [id])?;
    }
    conn.execute("DELETE FROM fts_names WHERE file_id IN (SELECT id FROM files WHERE path = ?1)", [path])?;
    conn.execute("DELETE FROM files WHERE path = ?1", [path])?;
    Ok(ids)
}

/// Remove every file under `prefix` (a folder that stopped being watched).
pub fn remove_prefix(conn: &Connection, prefix: &str) -> rusqlite::Result<Vec<i64>> {
    let pattern = format!("{}%", prefix.replace('%', "\\%").replace('_', "\\_"));
    let paths: Vec<String> = {
        let mut stmt = conn.prepare("SELECT path FROM files WHERE path LIKE ?1 ESCAPE '\\'")?;
        let rows = stmt.query_map([pattern], |r| r.get(0))?;
        rows.collect::<Result<_, _>>()?
    };
    let mut ids = Vec::new();
    for p in paths {
        ids.extend(remove_file(conn, &p)?);
    }
    Ok(ids)
}

/// Chunk ids that were replaced, and the new (chunk id, vector) pairs.
pub type Replaced = (Vec<i64>, Vec<(i64, Vec<f32>, bool)>);

pub struct NewChunk {
    pub label: Option<String>,
    pub text: Option<String>,
    pub vector: Option<Vec<f32>>,
    pub visual: bool,
}

/// Replace whatever was stored for this file. Returns (chunk id, vector,
/// visual) for every chunk that has a vector.
#[allow(clippy::too_many_arguments)]
pub fn upsert_file(
    conn: &mut Connection,
    path: &str,
    name: &str,
    kind: &str,
    size: i64,
    mtime: i64,
    model: &str,
    chunks: Vec<NewChunk>,
) -> rusqlite::Result<Replaced> {
    let removed = chunk_ids_for(conn, path)?;
    let tx = conn.transaction()?;
    for id in &removed {
        tx.execute("DELETE FROM fts WHERE chunk_id = ?1", [id])?;
    }
    tx.execute("DELETE FROM fts_names WHERE file_id IN (SELECT id FROM files WHERE path = ?1)", [path])?;
    tx.execute("DELETE FROM files WHERE path = ?1", [path])?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    tx.execute(
        "INSERT INTO files (path, name, kind, size, mtime, indexed_at, model) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![path, name, kind, size, mtime, now, model],
    )?;
    let file_id = tx.last_insert_rowid();
    tx.execute("INSERT INTO fts_names (name, path, file_id) VALUES (?1, ?2, ?3)", params![name, path, file_id])?;
    let mut added = Vec::new();
    for (ord, c) in chunks.into_iter().enumerate() {
        let blob = c.vector.as_ref().map(|v| to_blob(v));
        tx.execute(
            "INSERT INTO chunks (file_id, ord, label, text, vector, visual) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![file_id, ord as i64, c.label, c.text, blob, c.visual],
        )?;
        let chunk_id = tx.last_insert_rowid();
        // The first chunk carries the file name so name-only matches work for
        // every file, including images and media.
        insert_fts(&tx, chunk_id, (ord == 0).then_some(name), c.text.as_deref())?;
        if let Some(v) = c.vector {
            added.push((chunk_id, v, c.visual));
        }
    }
    tx.commit()?;
    Ok((removed, added))
}

/// Every stored vector and whether it's a picture, for loading the
/// in-memory index at startup.
pub fn all_vectors(conn: &Connection, dims: usize) -> rusqlite::Result<Vec<(i64, Vec<f32>, bool)>> {
    let mut stmt = conn.prepare("SELECT id, vector, visual FROM chunks WHERE vector IS NOT NULL")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Vec<u8>>(1)?, r.get::<_, bool>(2)?)))?;
    let mut out = Vec::new();
    for row in rows {
        let (id, blob, visual) = row?;
        let v = from_blob(&blob);
        if v.len() == dims {
            out.push((id, v, visual));
        }
    }
    Ok(out)
}

/// Full-text matches for the given words: (chunk id, bm25; lower is
/// better), best first. With `all`, every word must appear (in the file name
/// or the chunk's text); otherwise any one is enough. `prefix_last` matches
/// the last word as a prefix, for results while it's still being typed.
pub fn fts_search(
    conn: &Connection,
    terms: &[String],
    all: bool,
    prefix_last: bool,
    limit: usize,
) -> rusqlite::Result<Vec<(i64, f64)>> {
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let quoted: Vec<String> = terms
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let t = t.replace('"', "");
            if prefix_last && i == terms.len() - 1 && t.chars().count() >= 3 {
                format!("\"{t}\"*")
            } else {
                format!("\"{t}\"")
            }
        })
        .collect();
    let expr = quoted.join(if all { " AND " } else { " OR " });
    let mut stmt = conn.prepare(
        "SELECT chunk_id, bm25(fts, 4.0, 1.0) FROM fts WHERE fts MATCH ?1 ORDER BY bm25(fts, 4.0, 1.0) LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![expr, limit as i64], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

/// Files whose name or path contains every word of three or more letters as
/// a substring, best first, as the id of each file's first chunk.
pub fn name_search(conn: &Connection, terms: &[String], limit: usize) -> rusqlite::Result<Vec<i64>> {
    let parts: Vec<String> =
        terms.iter().filter(|t| t.chars().count() >= 3).map(|t| format!("\"{}\"", t.replace('"', ""))).collect();
    if parts.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        "SELECT (SELECT c.id FROM chunks c WHERE c.file_id = n.file_id ORDER BY c.ord LIMIT 1)
         FROM fts_names n WHERE fts_names MATCH ?1 ORDER BY bm25(fts_names, 4.0, 1.0) LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![parts.join(" AND "), limit as i64], |r| r.get::<_, Option<i64>>(0))?;
    Ok(rows.filter_map(|r| r.ok().flatten()).collect())
}

/// Files whose name shares any three-letter piece with one of `terms`, as
/// (first chunk id, file name), for typo-tolerant name matching. The caller
/// decides which are close enough.
pub fn name_candidates(conn: &Connection, terms: &[String], limit: usize) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut grams: Vec<String> = Vec::new();
    for t in terms {
        let chars: Vec<char> = t.chars().collect();
        for w in chars.windows(3) {
            let g: String = w.iter().collect();
            if !g.contains('"') && !grams.contains(&g) {
                grams.push(g);
            }
        }
    }
    if grams.is_empty() {
        return Ok(Vec::new());
    }
    let query = grams.iter().map(|g| format!("\"{g}\"")).collect::<Vec<_>>().join(" OR ");
    let mut stmt = conn.prepare(
        "SELECT (SELECT c.id FROM chunks c WHERE c.file_id = n.file_id ORDER BY c.ord LIMIT 1), n.name
         FROM fts_names n WHERE fts_names MATCH ?1 ORDER BY bm25(fts_names, 4.0, 0.0) LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![query, limit as i64], |r| Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, String>(1)?)))?;
    Ok(rows.filter_map(|r| r.ok()).filter_map(|(id, name)| Some((id?, name))).collect())
}

/// What a query restricts results to.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Filter {
    pub kind: Option<String>,
    /// File extension without the dot ("pdf").
    pub ext: Option<String>,
    /// Modified at or after (unix seconds).
    pub since: Option<i64>,
    /// A folder name the path must contain ("Downloads").
    pub folder: Option<String>,
}

impl Filter {
    pub fn is_empty(&self) -> bool {
        self.kind.is_none() && self.ext.is_none() && self.since.is_none() && self.folder.is_none()
    }

    pub fn allows(&self, file: &FileRow) -> bool {
        self.kind.as_deref().is_none_or(|k| k == file.kind)
            && self.ext.as_deref().is_none_or(|e| file.name.to_lowercase().ends_with(&format!(".{e}")))
            && self.since.is_none_or(|t| file.mtime >= t)
            && self.folder.as_deref().is_none_or(|f| {
                let want = f.to_lowercase();
                file.path.to_lowercase().split(['/', '\\']).any(|part| part == want)
            })
    }
}

/// Newest files that pass `filter`, as the id of each one's first chunk; for
/// queries that are nothing but filters ("pdfs from last week").
pub fn newest_matching(conn: &Connection, filter: &Filter, limit: usize) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT f.id, f.path, f.name, f.kind, f.size, f.mtime,
                (SELECT c.id FROM chunks c WHERE c.file_id = f.id ORDER BY c.ord LIMIT 1)
         FROM files f WHERE f.mtime >= ?1 AND (?2 IS NULL OR f.kind = ?2) ORDER BY f.mtime DESC LIMIT ?3",
    )?;
    let rows = stmt.query_map(
        params![filter.since.unwrap_or(i64::MIN), filter.kind, (limit * 20) as i64],
        |r| {
            Ok((
                FileRow { id: r.get(0)?, path: r.get(1)?, name: r.get(2)?, kind: r.get(3)?, size: r.get(4)?, mtime: r.get(5)? },
                r.get::<_, Option<i64>>(6)?,
            ))
        },
    )?;
    Ok(rows
        .filter_map(Result::ok)
        .filter(|(f, _)| filter.allows(f))
        .filter_map(|(_, c)| c)
        .take(limit)
        .collect())
}

/// How many picture vectors are stored (photos and video frames).
#[cfg(test)]
pub fn visual_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM chunks WHERE visual = 1 AND vector IS NOT NULL", [], |r| r.get(0))
        .unwrap_or(0)
}

pub fn chunk_with_file(conn: &Connection, chunk_id: i64) -> rusqlite::Result<Option<(FileRow, ChunkRow)>> {
    conn.query_row(
        "SELECT f.id, f.path, f.name, f.kind, f.size, f.mtime, c.label, c.text, c.visual
         FROM chunks c JOIN files f ON f.id = c.file_id WHERE c.id = ?1",
        [chunk_id],
        |r| {
            Ok((
                FileRow {
                    id: r.get(0)?,
                    path: r.get(1)?,
                    name: r.get(2)?,
                    kind: r.get(3)?,
                    size: r.get(4)?,
                    mtime: r.get(5)?,
                },
                ChunkRow { label: r.get(6)?, text: r.get(7)?, visual: r.get(8)? },
            ))
        },
    )
    .optional()
}

pub fn counts(conn: &Connection) -> (i64, i64) {
    let files = conn.query_row("SELECT COUNT(*) FROM files", [], |r| r.get(0)).unwrap_or(0);
    let chunks = conn.query_row("SELECT COUNT(*) FROM chunks", [], |r| r.get(0)).unwrap_or(0);
    (files, chunks)
}

/// Drop everything, e.g. after switching embedding model or dimensions.
pub fn clear(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("DELETE FROM fts; DELETE FROM fts_names; DELETE FROM chunks; DELETE FROM files;")
}

fn to_blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

fn from_blob(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}
