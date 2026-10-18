//! Evals for responsiveness under load. Each one reproduces a way a big
//! folder made WinFynd show "Not Responding" or stop indexing, and fails if
//! that behaviour comes back:
//!
//! - status sent to the windows once per file flooded the window thread;
//! - the watcher opened every file before watching, on the window thread;
//! - stored vectors were loaded on the window thread at startup;
//! - one bad file could take the indexer down.

use std::sync::atomic::AtomicUsize;

use super::e2e_tests::{fake_ollama, temp_dir, DIMS};
use super::*;

/// The most a status or config read may take while the indexer is busy.
/// The windows call these, so anything slower is felt as a stutter.
const UI_CALL_BUDGET: Duration = Duration::from_millis(50);

struct Running {
    engine: Arc<Engine>,
    emitted: Arc<AtomicUsize>,
}

/// An engine with its indexer and status publisher running, as in the app.
fn start(root: &Path, ollama_url: String) -> Running {
    let config = EngineConfig {
        roots: vec![root.to_path_buf()],
        ollama_url,
        dimensions: DIMS,
        ..EngineConfig::default()
    };
    let emitted = Arc::new(AtomicUsize::new(0));
    let counter = emitted.clone();
    let conn = db::open(&root.join(".index/index.sqlite3")).unwrap();
    let (engine, rx) = Engine::open(conn, config, root.join(".index/engine.json"), root.join(".index/speech"), move |_| {
        counter.fetch_add(1, Ordering::Relaxed);
    })
    .unwrap();
    let worker = engine.clone();
    std::thread::spawn(move || worker.run(rx));
    let publisher = Arc::downgrade(&engine);
    std::thread::spawn(move || publish_status(publisher, STATUS_EVERY));
    Running { engine, emitted }
}

/// Poll like the windows do until the index settles with `files` files,
/// checking that every read answers within budget. Returns how long it took.
fn wait_until_indexed(engine: &Engine, files: i64, limit: Duration) -> Duration {
    let started = Instant::now();
    let mut slowest = Duration::ZERO;
    loop {
        let t = Instant::now();
        let s = engine.status();
        let _ = engine.config();
        slowest = slowest.max(t.elapsed());
        if s.state == "idle" && s.queued == 0 && s.files == files {
            break;
        }
        assert!(started.elapsed() < limit, "not indexed after {limit:?}: {s:?}");
        std::thread::sleep(Duration::from_millis(2));
    }
    assert!(slowest < UI_CALL_BUDGET, "a status read took {slowest:?} while indexing");
    started.elapsed()
}

/// Updates the windows may receive over `elapsed`: one per publish tick,
/// plus slack for the first and last.
fn max_events(elapsed: Duration) -> usize {
    (elapsed.as_millis() / STATUS_EVERY.as_millis()) as usize + 3
}

fn write_tree(root: &Path, folders: usize, per_folder: usize) {
    for d in 0..folders {
        let dir = root.join(format!("project {d}"));
        std::fs::create_dir_all(&dir).unwrap();
        for f in 0..per_folder {
            std::fs::write(dir.join(format!("note {f}.txt")), format!("meeting notes {d} {f} about budget")).unwrap();
        }
    }
}

#[test]
fn stays_responsive_while_indexing_thousands_of_files() {
    let root = temp_dir("stress-index");
    write_tree(&root, 30, 40);
    let run = start(&root, fake_ollama());
    let batches = Arc::new(AtomicUsize::new(0));
    let counter = batches.clone();
    run.engine.on_activity(move |_| {
        counter.fetch_add(1, Ordering::Relaxed);
    });
    run.engine.enqueue(Job::Scan);

    let took = wait_until_indexed(&run.engine, 1200, Duration::from_secs(300));
    let sent = run.emitted.load(Ordering::Relaxed);
    assert!(sent <= max_events(took), "{sent} status events in {took:?}; the windows can't keep up with that");
    let sent = batches.load(Ordering::Relaxed);
    assert!(sent <= max_events(took), "{sent} file activity events in {took:?}; the windows can't keep up with that");
    assert!(run.engine.search("budget", 5).semantic);

    // A rescan with nothing changed is quick and just as quiet.
    let before = run.emitted.load(Ordering::Relaxed);
    let started = Instant::now();
    run.engine.enqueue(Job::Scan);
    std::thread::sleep(STATUS_EVERY * 2);
    let took = wait_until_indexed(&run.engine, 1200, Duration::from_secs(30));
    let sent = run.emitted.load(Ordering::Relaxed) - before;
    assert!(sent <= max_events(started.elapsed()), "{sent} status events for a rescan");
    assert!(took < Duration::from_secs(15), "rescan of unchanged files took {took:?}");
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_crashing_file_does_not_stop_indexing() {
    let root = temp_dir("stress-crash");
    std::fs::write(root.join("crash-for-test report.pdf"), b"%PDF-1.4 garbage").unwrap();
    std::fs::write(root.join("after.txt"), "the file after the bad one").unwrap();
    let run = start(&root, fake_ollama());
    run.engine.enqueue(Job::Scan);

    wait_until_indexed(&run.engine, 2, Duration::from_secs(30));
    assert_eq!(run.engine.status().unreadable, 1);
    // Still found by name.
    assert_eq!(run.engine.search("crash report", 5).hits[0].name, "crash-for-test report.pdf");
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_folder_dropped_in_is_indexed_without_a_full_rescan() {
    let root = temp_dir("stress-dropin");
    write_tree(&root, 1, 3);
    let run = start(&root, fake_ollama());
    run.engine.enqueue(Job::Scan);
    wait_until_indexed(&run.engine, 3, Duration::from_secs(30));

    let unpacked = root.join("unpacked");
    std::fs::create_dir_all(unpacked.join("inner")).unwrap();
    std::fs::write(unpacked.join("inner/readme.txt"), "zebra crossing").unwrap();
    // The watcher reports a new folder and everything inside it at once.
    for _ in 0..50 {
        run.engine.enqueue(Job::ScanDir(unpacked.clone()));
    }
    wait_until_indexed(&run.engine, 4, Duration::from_secs(30));
    assert_eq!(run.engine.search("zebra", 5).hits[0].name, "readme.txt");
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn startup_does_not_wait_for_a_big_index_to_load() {
    let root = temp_dir("stress-startup");
    let path = root.join(".index/index.sqlite3");
    {
        let mut conn = db::open(&path).unwrap();
        let v = vec![0.125f32; DIMS];
        for f in 0..2000 {
            let chunks = (0..10)
                .map(|_| db::NewChunk { label: None, text: Some("words".into()), vector: Some(v.clone()), visual: false })
                .collect();
            db::upsert_file(&mut conn, &format!("/f{f}"), "f", "text", 1, 1, "m", chunks).unwrap();
        }
    }

    let started = Instant::now();
    let config = EngineConfig { roots: vec![], dimensions: DIMS, ..EngineConfig::default() };
    let conn = db::open(&path).unwrap();
    let (engine, _rx) = Engine::open(conn, config, root.join("engine.json"), root.join("speech"), |_| {}).unwrap();
    let took = started.elapsed();
    assert!(took < Duration::from_millis(500), "opening the engine took {took:?}");
    assert_eq!(engine.status().state, "loading");

    engine.load_index();
    assert_eq!(engine.vectors.read().unwrap().len(), 20_000);
    assert_eq!((engine.status().files, engine.status().state.as_str()), (2000, "idle"));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn watcher_starts_quickly_on_a_big_tree() {
    let root = temp_dir("stress-watch");
    write_tree(&root, 200, 100);
    let (tx, _rx) = mpsc::channel();
    let started = Instant::now();
    let w = watch::Watcher::start(&[root.clone()], Vec::new(), tx);
    let took = started.elapsed();
    assert!(w.is_some());
    assert!(took < Duration::from_secs(3), "watching 20,000 files took {took:?} to start");
    drop(w);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn slow_or_crashing_readers_are_abandoned() {
    assert_eq!(run_with_timeout(Duration::from_secs(5), || 7), Ok(7));
    assert_eq!(run_with_timeout(Duration::from_secs(5), || -> i32 { panic!("bad file") }), Err("crashed"));
    let started = Instant::now();
    let r = run_with_timeout(Duration::from_millis(100), || std::thread::sleep(Duration::from_secs(5)));
    assert_eq!(r, Err("took too long"));
    assert!(started.elapsed() < Duration::from_secs(1));
}
