//! End-to-end: index a folder through a fake Ollama server, then search and ask.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;

use serde_json::{json, Value};

use super::config::EngineConfig;
use super::*;

const DIMS: usize = 64;

/// Bag-of-words vector, so texts sharing words land close together.
fn fake_embedding(text: &str) -> Vec<f32> {
    let mut v = vec![0.0f32; DIMS];
    for w in text.split(|c: char| !c.is_alphanumeric()).filter(|w| w.len() > 2) {
        let h = w.to_lowercase().bytes().fold(7u64, |h, b| h.wrapping_mul(31).wrapping_add(b as u64));
        v[(h % DIMS as u64) as usize] += 1.0;
    }
    v
}

fn strip_prompt(s: &str) -> String {
    if let Some(q) = s.strip_prefix("task: search result | query: ") {
        return q.to_string();
    }
    match s.split_once(" | text: ") {
        Some((title, text)) => format!("{} {}", title.trim_start_matches("title: "), text),
        None => s.to_string(),
    }
}

/// A tiny HTTP server that speaks just enough of the Ollama API.
fn fake_ollama() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut request_line = String::new();
            reader.read_line(&mut request_line).unwrap();
            let mut len = 0;
            loop {
                let mut h = String::new();
                reader.read_line(&mut h).unwrap();
                if h == "\r\n" || h.is_empty() {
                    break;
                }
                if let Some(v) = h.to_ascii_lowercase().strip_prefix("content-length:") {
                    len = v.trim().parse().unwrap();
                }
            }
            let mut body = vec![0; len];
            reader.read_exact(&mut body).unwrap();
            let body: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);

            let resp = if request_line.contains("/api/tags") {
                json!({ "models": [{ "name": "embeddinggemma-2:latest", "size": 1 }, { "name": "testchat:latest", "size": 1 }] })
            } else if request_line.contains("/api/embed") {
                assert_eq!(body["dimensions"], DIMS);
                let embeddings: Vec<Vec<f32>> = body["input"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|i| match i {
                        Value::String(s) => fake_embedding(&strip_prompt(s)),
                        // Every test image "shows" a beach.
                        _ => {
                            assert!(i["image"].as_str().is_some_and(|b| !b.is_empty()));
                            fake_embedding("sunny beach sand sea")
                        }
                    })
                    .collect();
                json!({ "embeddings": embeddings })
            } else if request_line.contains("/api/chat") {
                assert_eq!(body["model"], "testchat:latest");
                let user = body["messages"][1]["content"].as_str().unwrap();
                assert!(user.contains("[1]"));
                json!({ "message": { "role": "assistant", "content": "It moves to June [1]." } })
            } else {
                json!({})
            };
            let text = resp.to_string();
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                text.len(),
                text
            );
        }
    });
    format!("http://{addr}")
}

fn temp_dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("winfynd-test-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn engine_for(root: &std::path::Path, ollama_url: String) -> Arc<Engine> {
    let config = EngineConfig {
        roots: vec![root.to_path_buf()],
        ollama_url,
        dimensions: DIMS,
        chat_model: String::new(),
        ..EngineConfig::default()
    };
    let conn = db::open(&root.join(".index/index.sqlite3")).unwrap();
    let (engine, _rx) = Engine::open(conn, config, root.join(".index/engine.json"), |_| {}).unwrap();
    engine
}

#[test]
fn indexes_searches_and_answers() {
    let root = temp_dir("e2e");
    std::fs::write(root.join("product-sync-notes.txt"), "Rahul said the launch moves to June because QA needs another cycle.").unwrap();
    std::fs::write(root.join("groceries.md"), "Shopping list: apples, bananas, oat milk, coffee beans.").unwrap();
    std::fs::write(root.join("holiday clip.mp4"), b"not really a video").unwrap();
    image::RgbImage::from_pixel(32, 32, image::Rgb([200, 180, 90])).save(root.join("IMG_4410.png")).unwrap();
    std::fs::create_dir_all(root.join("node_modules")).unwrap();
    std::fs::write(root.join("node_modules/ignored.txt"), "launch june").unwrap();

    let engine = engine_for(&root, fake_ollama());
    engine.refresh_ollama_state();
    assert_eq!(engine.status().ollama, "ok");
    let files = engine.walk_roots();
    assert_eq!(files.len(), 4, "node_modules and the index folder are skipped: {files:?}");
    files.iter().for_each(|p| engine.index_file(p));

    // Meaning (shared words in the fake model) and exact words both find the notes.
    let r = engine.search("when does the launch move", 10);
    assert!(r.semantic);
    assert_eq!(r.hits[0].name, "product-sync-notes.txt");
    assert!(r.hits[0].snippet.as_deref().unwrap().contains("June"));

    // Text query finds the image through the shared text/image space.
    let r = engine.search("beach", 10);
    assert_eq!(r.hits[0].name, "IMG_4410.png");
    assert_eq!(r.hits[0].reason, "Image matches your search");

    // Media without readable content is still found by name.
    let r = engine.search("holiday", 10);
    assert_eq!(r.hits[0].name, "holiday clip.mp4");

    // Unchanged files are skipped on rescan; deleted ones disappear.
    let before = db::counts(&engine.db.lock().unwrap());
    files.iter().for_each(|p| engine.index_file(p));
    assert_eq!(before, db::counts(&engine.db.lock().unwrap()));
    std::fs::remove_file(root.join("groceries.md")).unwrap();
    engine.index_file(&root.join("groceries.md"));
    assert!(engine.search("bananas", 10).hits.iter().all(|h| h.name != "groceries.md"));

    let answer = engine.ask("When is the launch?").unwrap();
    assert_eq!(answer.model, "testchat:latest");
    assert_eq!(answer.sources[0].name, "product-sync-notes.txt");
    assert!(answer.text.contains("June"));

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn falls_back_to_exact_words_when_ollama_is_down() {
    let root = temp_dir("offline");
    std::fs::write(root.join("budget.txt"), "Quarterly budget review with finance").unwrap();
    // Nothing listens on port 9 of loopback.
    let engine = engine_for(&root, "http://127.0.0.1:9".into());
    engine.refresh_ollama_state();
    assert_eq!(engine.status().ollama, "offline");
    engine.index_file(&root.join("budget.txt"));

    let r = engine.search("budget", 10);
    assert!(!r.semantic);
    assert_eq!(r.hits[0].name, "budget.txt");

    // Stored as not embedded, so it's picked up again once Ollama is back.
    let stamp = db::file_stamp(&engine.db.lock().unwrap(), &root.join("budget.txt").to_string_lossy()).unwrap();
    assert_eq!(stamp.unwrap().2, NOT_EMBEDDED);
    let _ = std::fs::remove_dir_all(&root);
}
