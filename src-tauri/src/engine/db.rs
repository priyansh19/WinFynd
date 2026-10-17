//! SQLite store: one row per file, one per chunk (a page, slide, sheet or
//! window of text, or a whole image), a vector per chunk and a full-text
//! index for exact words and file names.

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
         CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(name, text, chunk_id UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');",
    )?;
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
pub type Replaced = (Vec<i64>, Vec<(i64, Vec<f32>)>);

pub struct NewChunk {
    pub label: Option<String>,
    pub text: Option<String>,
    pub vector: Option<Vec<f32>>,
}

/// Replace whatever was stored for this file. Returns (chunk id, vector) for
/// every chunk that has one.
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
    let mut added = Vec::new();
    for (ord, c) in chunks.into_iter().enumerate() {
        let blob = c.vector.as_ref().map(|v| to_blob(v));
        tx.execute(
            "INSERT INTO chunks (file_id, ord, label, text, vector) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![file_id, ord as i64, c.label, c.text, blob],
        )?;
        let chunk_id = tx.last_insert_rowid();
        // The first chunk carries the file name so name-only matches work for
        // every file, including images and media.
        let fts_name = if ord == 0 { name } else { "" };
        let fts_text = c.text.as_deref().unwrap_or("");
        if !fts_name.is_empty() || !fts_text.is_empty() {
            tx.execute(
                "INSERT INTO fts (name, text, chunk_id) VALUES (?1, ?2, ?3)",
                params![fts_name, fts_text, chunk_id],
            )?;
        }
        if let Some(v) = c.vector {
            added.push((chunk_id, v));
        }
    }
    tx.commit()?;
    Ok((removed, added))
}

/// Every stored vector, for loading the in-memory index at startup.
pub fn all_vectors(conn: &Connection, dims: usize) -> rusqlite::Result<Vec<(i64, Vec<f32>)>> {
    let mut stmt = conn.prepare("SELECT id, vector FROM chunks WHERE vector IS NOT NULL")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Vec<u8>>(1)?)))?;
    let mut out = Vec::new();
    for row in rows {
        let (id, blob) = row?;
        let v = from_blob(&blob);
        if v.len() == dims {
            out.push((id, v));
        }
    }
    Ok(out)
}

/// Full-text matches: (chunk id, bm25 rank; lower is better).
pub fn fts_search(conn: &Connection, query: &str, limit: usize) -> rusqlite::Result<Vec<(i64, f64)>> {
    let terms: Vec<String> = query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() > 1)
        .map(|t| format!("\"{t}\"*"))
        .collect();
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let expr = terms.join(" OR ");
    let mut stmt = conn.prepare(
        "SELECT chunk_id, bm25(fts, 4.0, 1.0) FROM fts WHERE fts MATCH ?1 ORDER BY bm25(fts, 4.0, 1.0) LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![expr, limit as i64], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

pub fn chunk_with_file(conn: &Connection, chunk_id: i64) -> rusqlite::Result<Option<(FileRow, ChunkRow)>> {
    conn.query_row(
        "SELECT f.id, f.path, f.name, f.kind, f.size, f.mtime, c.label, c.text
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
                ChunkRow { label: r.get(6)?, text: r.get(7)? },
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
    conn.execute_batch("DELETE FROM fts; DELETE FROM chunks; DELETE FROM files;")
}

fn to_blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

fn from_blob(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}
