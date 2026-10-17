# WinFynd

Find anything on your Windows PC by typing or speaking. Files are indexed as they appear and every model runs on your machine, so nothing leaves your computer.

## What's here

A Tauri 2 app with a Rust backend and a React + TypeScript UI:

- **Launcher** (`launcher.html`, `src/launcher/`): a frameless, always-on-top glass window. Results are grouped by type, and the preview jumps to the matching moment (a video timestamp, a slide, a line in a recording). Tab switches to Ask mode, which answers from your files with numbered sources.
- **Control Center** (`index.html`, `src/control/`): the background window for on-device models and hotkeys. Closing it keeps WinFynd running in the tray.
- **Global hotkeys** (`src-tauri/src/hotkeys.rs`): configurable, saved to the app config folder, and released while you record a new combo.

| Action | Default |
| --- | --- |
| Open the launcher | Alt+Space |
| Voice search (hold to talk, or press to toggle) | Alt+Shift+Space |
| Ask a question | Ctrl+Alt+Space |
| Search selected text | Win+Shift+F |

## How search works

- **Embeddings: EmbeddingGemma 2**, open weights, run locally through [Ollama](https://ollama.com) on `127.0.0.1` only. Text and photos land in one vector space, so "zebra on a beach" finds the photo as well as the notes about it.
- **Indexer** (`src-tauri/src/engine/`): watches your Documents, Desktop, Downloads and Pictures (change them on the Overview page), extracts text from PDF, Word, PowerPoint, Excel/CSV, OpenDocument, HTML, Markdown and code, chunks it with page and slide labels, and stores everything in SQLite next to the app config. Unchanged files are skipped on rescan; OneDrive files that aren't downloaded are indexed by name only.
- **Hybrid search**: vector similarity and SQLite full-text search, fused by rank, one result per file with the reason it matched ("Exact words on page 3").
- **Ask mode**: sends the top passages to an Ollama chat model you have installed (pick one on the Models page) and answers with numbered sources.
- If Ollama isn't running, search falls back to exact words and files are re-embedded once it's back.

### First run

```sh
ollama pull embeddinggemma-2   # or press Download on the Models page
ollama pull gemma4             # optional, any chat model for Ask mode
```

The Models page also switches between the 740M, 440M and 270M variants and the vector size (768, 512 or 256). Changing either rebuilds the index.

### Audio and video

Recordings and videos are searched by what's in them, not just their names:

- **What's said**: Whisper (whisper.cpp, built into the app) transcribes the sound track on your PC. Pick a model on the Models page (Base, Small or Large v3 Turbo); it downloads once from the whisper.cpp model repository on Hugging Face. Transcripts are chunked by time, so a result says "Said at 12:05" and the preview plays from there. MP3, M4A, WAV, FLAC, OGG and the audio in MP4/MKV decode without anything else installed.
- **What's shown**: up to 48 evenly spaced frames per video (near-duplicates skipped) are embedded with EmbeddingGemma 2 like photos, so "dog on a beach" finds the moment in a video. This needs FFmpeg (`winget install Gyan.FFmpeg`), which also lets every other audio format be transcribed.
- Media is indexed after everything else in a scan, because transcription is the slow part. Up to the first 4 hours of a file is transcribed.

### Not done yet

- Voice search in the launcher measures the microphone level, but doesn't turn your speech into a query yet. The Whisper model above is what it will use.

## Develop

Prerequisites: Node 20+, Rust stable, the [Tauri prerequisites for Windows](https://tauri.app/start/prerequisites/) (WebView2 and the MSVC build tools), and CMake plus LLVM for building whisper.cpp (`winget install Kitware.CMake LLVM.LLVM`).

```sh
npm install
npm run tauri dev     # run the desktop app
npm run dev           # UI only, in a browser at http://localhost:1420 (launcher at /launcher.html)
npm run tauri build   # installer in src-tauri/target/release/bundle
```

`cargo test` in `src-tauri` runs the engine end to end against a fake Ollama server.
