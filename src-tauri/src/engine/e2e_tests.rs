//! End-to-end: index a folder through a fake Ollama server, then search and ask.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;

use serde_json::{json, Value};

use super::config::EngineConfig;
use super::*;

/// Wide enough that unrelated words rarely share a slot in the fake model.
const DIMS: usize = 512;

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
    fake_ollama_with(true)
}

/// Like `fake_ollama`, but answers 400 to any image, like a text-only tag.
fn fake_ollama_without_images() -> String {
    fake_ollama_with(false)
}

fn fake_ollama_with(images: bool) -> String {
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

            let has_image = body["input"].as_array().is_some_and(|a| a.iter().any(Value::is_object));
            if !images && request_line.contains("/api/embed") && has_image {
                let _ = write!(stream, "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                continue;
            }
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
    let (engine, _rx) =
        Engine::open(conn, config, root.join(".index/engine.json"), root.join(".index/speech"), |_| {}).unwrap();
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

/// Stands in for Whisper: "hears" the same sentence in any audio.
struct FakeWhisper;

impl speech::Transcribe for FakeWhisper {
    fn transcribe(&self, samples: &[f32]) -> Result<Vec<media::Segment>, String> {
        assert!(samples.len() >= media::SAMPLE_RATE, "expected at least a second of 16 kHz audio");
        Ok(vec![
            media::Segment { start: 0.0, text: "Welcome back everyone.".into() },
            media::Segment { start: 2.0, text: "We booked the zebra safari for March.".into() },
        ])
    }
}

/// A two-second 44.1 kHz stereo WAV tone, decodable without FFmpeg.
fn write_wav(path: &std::path::Path) {
    let rate = 44_100u32;
    let frames = rate * 2;
    let mut data = Vec::new();
    for i in 0..frames {
        let s = ((i as f32 * 440.0 * std::f32::consts::TAU / rate as f32).sin() * 8000.0) as i16;
        data.extend_from_slice(&s.to_le_bytes());
        data.extend_from_slice(&s.to_le_bytes());
    }
    let mut wav = Vec::new();
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&rate.to_le_bytes());
    wav.extend_from_slice(&(rate * 4).to_le_bytes());
    wav.extend_from_slice(&4u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(data.len() as u32).to_le_bytes());
    wav.extend_from_slice(&data);
    std::fs::write(path, wav).unwrap();
}

#[test]
fn indexes_what_is_said_in_audio() {
    let root = temp_dir("audio");
    write_wav(&root.join("voice memo 12.wav"));
    let engine = engine_for(&root, fake_ollama());
    // Decode with the built-in decoder, not FFmpeg.
    *engine.ffmpeg.write().unwrap() = None;
    let mut cfg = engine.config();
    cfg.speech_model = "fake".into();
    *engine.config.write().unwrap() = cfg;
    *engine.speech.lock().unwrap() = Some(("fake".into(), Arc::new(FakeWhisper)));
    engine.refresh_ollama_state();
    engine.index_file(&root.join("voice memo 12.wav"));

    let r = engine.search("zebra safari", 10);
    assert_eq!(r.hits[0].name, "voice memo 12.wav");
    assert_eq!(r.hits[0].location.as_deref(), Some("0:00"));
    assert!(r.hits[0].reason.starts_with("Said at 0:00"), "{}", r.hits[0].reason);
    assert!(r.hits[0].snippet.as_deref().unwrap().contains("zebra safari"));

    let answer = engine.ask("When is the zebra safari?").unwrap();
    assert_eq!(answer.sources[0].name, "voice memo 12.wav");
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn indexes_what_is_shown_in_video() {
    let Some(ffmpeg) = media::find_ffmpeg() else {
        eprintln!("FFmpeg not installed; skipping");
        return;
    };
    let root = temp_dir("video");
    let video = root.join("trip.mp4");
    // Twenty seconds of a moving test pattern with a tone.
    let ok = std::process::Command::new(&ffmpeg)
        .args(["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=20:size=320x240:rate=10"])
        .args(["-f", "lavfi", "-i", "sine=frequency=300:duration=20", "-shortest"])
        .args(["-pix_fmt", "yuv420p", "-c:v", "mpeg4", "-c:a", "aac"])
        .arg(&video)
        .status()
        .unwrap()
        .success();
    assert!(ok);

    let engine = engine_for(&root, fake_ollama());
    engine.refresh_ollama_state();
    engine.index_file(&video);

    // Every frame "shows" a beach in the fake model.
    let r = engine.search("beach", 10);
    assert_eq!(r.hits[0].name, "trip.mp4");
    assert!(r.hits[0].reason.starts_with("Shown at "), "{}", r.hits[0].reason);
    let frames = db::counts(&engine.db.lock().unwrap()).1 - 1;
    assert!(frames >= 2, "expected several distinct frames, got {frames}");

    // FFmpeg's decoder feeds the speech model too.
    let mut got = 0;
    media::decode_audio(&video, Some(&ffmpeg), |piece, _| got += piece.len());
    assert!((got as i64 - 20 * media::SAMPLE_RATE as i64).abs() < media::SAMPLE_RATE as i64);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn returns_only_relevant_files_among_many() {
    let root = temp_dir("relevance");
    // Plenty of unrelated files, like a real Documents folder.
    let topics = [
        "Grocery list with apples bananas oat milk and coffee beans for the week",
        "Notes from the dentist appointment about a cleaning next spring",
        "Draft blog post about learning Rust lifetimes and the borrow checker",
        "Wedding guest list with table numbers and dietary preferences",
        "Meeting minutes: hiring plan for the support team in Pune",
        "Recipe for paneer butter masala with cream and kasuri methi",
    ];
    for i in 0..120 {
        std::fs::write(root.join(format!("note-{i}.txt")), format!("{} number {i}.", topics[i % topics.len()])).unwrap();
    }
    std::fs::write(
        root.join("car-insurance.txt"),
        "The car insurance renewal is due in May. The premium went up compared to last year. Call the broker before then.\n\n\
         Unrelated paragraph about the garden: tomatoes and basil need watering every evening.",
    )
    .unwrap();
    image::RgbImage::from_pixel(32, 32, image::Rgb([200, 180, 90])).save(root.join("IMG_0001.jpg")).unwrap();

    let engine = engine_for(&root, fake_ollama());
    engine.refresh_ollama_state();
    engine.walk_roots().iter().for_each(|p| engine.index_file(p));

    let confident = |q: &str| -> Vec<String> {
        engine.search(q, 30).hits.into_iter().filter(|h| h.confident).map(|h| h.name).collect()
    };
    let r = engine.search("car insurance premium", 30);
    assert_eq!(confident("car insurance premium"), vec!["car-insurance.txt"], "{:?}", r.hits);
    assert_eq!(r.hits[0].name, "car-insurance.txt");
    assert!(r.hits[0].snippet.as_deref().unwrap().contains("insurance"));
    // Weaker matches are capped and come after.
    assert!(r.hits.len() <= 1 + 8 && r.hits[1..].iter().all(|h| !h.confident));

    // A photo surfaces among a hundred text files, and "photo" filters to photos.
    let r = engine.search("photo of the beach", 30);
    assert_eq!(r.hits.iter().map(|h| h.name.as_str()).collect::<Vec<_>>(), vec!["IMG_0001.jpg"]);
    assert_eq!(r.hits[0].reason, "Image matches your search");
    assert_eq!(r.filters[0].label, "Photos");

    // A query that is only a filter lists the newest matching files.
    let r = engine.search("photos", 30);
    assert_eq!(r.hits.len(), 1);
    assert!(r.hits[0].confident);

    // Filler words alone ("find the file about") match nothing confidently.
    assert!(confident("find the file about").is_empty());
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn text_still_indexes_when_the_model_rejects_images() {
    let root = temp_dir("noimg");
    image::RgbImage::from_pixel(32, 32, image::Rgb([10, 10, 10])).save(root.join("receipt scan.png")).unwrap();
    std::fs::write(root.join("plan.txt"), "Quarterly roadmap planning").unwrap();
    let engine = engine_for(&root, fake_ollama_without_images());
    engine.refresh_ollama_state();
    engine.walk_roots().iter().for_each(|p| engine.index_file(p));
    assert_eq!(engine.status().ollama, "ok", "an image error must not mark Ollama offline");
    assert_eq!(engine.search("roadmap", 10).hits[0].name, "plan.txt");
    assert_eq!(engine.search("receipt", 10).hits[0].name, "receipt scan.png");
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn eval_reports_rank_and_empty_answers() {
    let root = temp_dir("eval");
    std::fs::write(root.join("lease-renewal.txt"), "The apartment lease renewal is due in January.").unwrap();
    std::fs::write(root.join("groceries.md"), "Shopping list: apples, bananas, oat milk.").unwrap();
    let engine = engine_for(&root, fake_ollama());
    engine.refresh_ollama_state();
    engine.walk_roots().iter().for_each(|p| engine.index_file(p));
    let cases = vec![
        eval::Case { query: "lease renewal".into(), expect: vec!["lease-renewal.txt".into()] },
        eval::Case { query: "zebra quantum toaster".into(), expect: vec![] },
    ];
    let r = eval::evaluate(&engine, &cases);
    assert_eq!((r.cases, r.empty_cases), (1, 1));
    assert_eq!(r.top1, 1.0);
    assert_eq!(r.mrr, 1.0);
    assert_eq!(r.empty_correct, 1.0, "{:?}", r.misses);
    let _ = std::fs::remove_dir_all(&root);
}
