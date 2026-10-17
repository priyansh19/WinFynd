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

Search results and answers are sample data for now (`src/lib/search.ts`) until the indexer is built. Voice capture measures the microphone level, but speech-to-text isn't wired up yet.

## Develop

Prerequisites: Node 20+, Rust stable, and the [Tauri prerequisites for Windows](https://tauri.app/start/prerequisites/) (WebView2 and the MSVC build tools).

```sh
npm install
npm run tauri dev     # run the desktop app
npm run dev           # UI only, in a browser at http://localhost:1420 (launcher at /launcher.html)
npm run tauri build   # installer in src-tauri/target/release/bundle
```
