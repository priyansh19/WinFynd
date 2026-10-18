# WinFynd

Find anything on your Windows PC by typing or speaking. Files are indexed as they appear and every model runs on your machine, so nothing leaves your computer.

## What's here

A Tauri 2 app with a Rust backend and a React + TypeScript UI:

- **Launcher** (`launcher.html`, `src/launcher/`): a PowerToys Run–style search box on Acrylic that opens on the monitor you're using and grows as results arrive. Results show Explorer's own icons and thumbnails, grouped by type, with a details pane that jumps to the matching moment (a video timestamp, a slide, a line in a recording). Enter opens, Ctrl+Shift+E opens the file location, Ctrl+Shift+C copies the path, Ctrl+K lists every action. Type `?` (or press Ask) to ask a question, answered from your files with numbered sources.
- **Settings** (`index.html`, `src/control/`): laid out like Windows Settings, on Mica, for folders, on-device models and hotkeys. Closing it keeps WinFynd running in the notification area.

Both windows follow the Windows light/dark theme and your accent colour, and use Fluent (WinUI 3) controls, type and icons.
- **Global hotkeys** (`src-tauri/src/hotkeys.rs`): configurable, saved to the app config folder, and released while you record a new combo.

| Action | Default |
| --- | --- |
| Open the launcher | Alt+Space |
| Voice search (hold to talk, or press to toggle) | Alt+Shift+Space |
| Ask a question | Ctrl+Alt+Space |
| Search selected text | Win+Shift+F |

## How search works

- **Embeddings: EmbeddingGemma 2**, open weights, run locally through [Ollama](https://ollama.com) on `127.0.0.1` only. Text and photos land in one vector space, so "zebra on a beach" finds the photo as well as the notes about it.
- **Indexer** (`src-tauri/src/engine/`): watches your Documents, Desktop, Downloads and Pictures (change them on the Overview page), extracts text from PDF, Word, PowerPoint, Excel/CSV, OpenDocument, HTML, Markdown and code, and stores everything in SQLite next to the app config. Text is cut into chunks of about 1,000 characters (roughly 250 tokens) along sentences, paragraphs and headings, with page and slide labels; each chunk is embedded with its folder and section, and every file also gets a short card (name, folders, kind, year, opening lines) so it can be found as a whole. Logs, data files (JSON, CSV, XML, YAML and similar) and minified code are searched by their words only, and build folders like `node_modules`, `dist` and `.git` are skipped. Unchanged files are skipped on rescan; OneDrive files that aren't downloaded are indexed by name only, and indexed again in full once they are.
- **Hybrid search**: up to six ranked lists, fused by rank (reciprocal rank fusion) with one vote per file per list: text meaning, picture meaning, chunks with all your words (stemmed, so "invoices" finds "invoice"), chunks with some of them, and file names and paths (partial words work). Filler words ("find the file about") are dropped. Words like "photo of", "pdf", "last week" or "in Downloads" become filters, shown as chips you can click to remove. Results that clearly match come first; the rest are listed under "Weaker matches", at most 8 of them, so a search for one thing doesn't fill up with things that aren't it.
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
npm run tauri build   # the app and its plain NSIS installer, in src-tauri/target/release/bundle
npm run build:installer   # WinFynd Setup, in dist-installer (Windows only)
```

### Installer

`npm run build:installer` makes `dist-installer/WinFynd-Setup-<version>.exe`, a small Windows 11 style setup window (`setup/`) with the NSIS installer from `tauri build` inside it.

- It installs per user to `%LOCALAPPDATA%\WinFynd`, so there's no admin prompt. The folder can be changed on a fresh install.
- It offers "Start WinFynd when I sign in" (on by default) and a desktop shortcut (off). Starting at sign-in passes `--background`, so WinFynd stays in the tray.
- Run over an older version, it updates in place: it keeps the index and settings, and restarts WinFynd if it was running.
- The same window, built without the installer inside, ships as `uninstall-ui.exe` and is what Settings > Apps opens. Deleting the index and settings is an opt-in checkbox.
- NSIS still does the actual install and the Apps entry, run silently (`/S`). If WebView2 is missing, setup opens the stock NSIS wizard instead, which installs WebView2 first.

Open `setup/ui/index.html` in a browser to preview the screens on sample data, for example `?mode=update` or `?mode=uninstall`.

### Release

The Release workflow (`.github/workflows/release.yml`) builds WinFynd Setup on Windows, installs it once and checks that WinFynd starts, then publishes it to GitHub releases as `v<version>` with `SHA256SUMS.txt`.

1. Set the new version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `setup/Cargo.toml`, `setup/tauri.conf.json` and `package.json`, then run `cargo check` in `src-tauri` and `setup` so the lockfiles follow.
2. Write the release notes in `docs/releases/<version>.md`.
3. Merge to main, then run Actions > Release > Run workflow on main (or push the tag `v<version>`).

Pull requests that touch the installer run the same build and check without publishing.

`cargo test` in `src-tauri` runs the engine end to end against a fake Ollama server.

To measure search on a real index, write queries with the file each should find (see `src-tauri/eval/cases.example.json`; an empty `expect` means nothing should match) and run:

```sh
cd src-tauri
WINFYND_EVAL=eval/cases.json cargo test --release --lib eval_real_index -- --ignored --nocapture
```

It reads the index the app built (`%APPDATA%\app.winfynd.desktop`, or `WINFYND_DATA`) and prints how often the right file is first, in the top 5, and which queries missed.
