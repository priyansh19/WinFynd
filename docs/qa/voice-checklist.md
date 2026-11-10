# WinFynd voice-to-query checklist (Windows 10 & 11)

**v0.2.0 regression.** Voice search ships in v0.2.0. Priyansh confirmed it on his Windows 10 and Windows 11 PCs. Run this checklist again on the v0.2.0 build. A failure here is a release no-go, not a decision to hide voice. The steps below are the voice checklist unchanged apart from this note.

**App under test:** WinFynd **v0.1.1** (installer from [GitHub Releases](https://github.com/priyansh19/WinFynd/releases)), then the same steps on any **v0.2.0** test build.  
**Tester:** Priyansh (real PCs only).  
**Code basis:** `main` — `src/launcher/Voice.tsx`, `Launcher.tsx`, `src/control/pages/Shortcuts.tsx`, `Models.tsx`, `src-tauri/src/engine/speech.rs`, `commands.rs` (`transcribe_voice`), `engine/mod.rs` (`transcribe_query`), `tauri.conf.json`, `capabilities/default.json`.  
**Do not invent UI.** Labels below are quoted from the code. Where a Windows/WebView2 prompt has no app-owned label, that is called out.

---

## How voice works (read once)

1. Speech is **not** in the installer. Whisper is downloaded on demand into `%APPDATA%\app.winfynd.desktop\speech\` (e.g. `ggml-small.bin`). Setup checkbox **"Also search speech in recordings and videos"** starts **Whisper Small** (~488 MB). Settings → **Models** → **Speech** can **Download** / **Use** **Whisper Base** (148 MB), **Whisper Small** (488 MB), or **Whisper Large v3 Turbo** (574 MB).
2. Voice search needs `speech_model` set. If it is empty, the app error is: **"Turn on speech on the Models page to talk to search."** Settings → **Folders** → **"Speech in recordings and videos"** off clears that setting and breaks voice too.
3. Default shortcut: **Alt+Shift+Space**, mode **"Hold the shortcut while you speak"** (Settings → **Shortcuts & voice** → **"How talking works"**). Mic button in the launcher is **"Search by voice"** (aria-label / title).
4. Capture is browser `getUserMedia` in WebView2 → resampled to 16 kHz mono → Tauri command `transcribe_voice` → local whisper.cpp. Language is **`auto`** (multilingual). Max listen: **30 seconds**, then it stops itself. Esc (or losing focus) **cancels** without searching.
5. Log file: `%LOCALAPPDATA%\app.winfynd.desktop\logs\winfynd.log` (older rotate: `winfynd.old.log`). Version: Settings → **About** → **"Version 0.1.1 · …"** (or the build under test).

---

## PC A — Windows 10

| Field | Fill in |
| --- | --- |
| PC name | |
| `winver` (e.g. 19045.xxxx) | |
| Mic type (built-in / USB / headset) | |
| Install type this run | ☐ Clean install &nbsp;&nbsp; ☐ Upgrade over previous WinFynd |
| Build under test | ☐ v0.1.1 release &nbsp;&nbsp; ☐ v0.2.0 test build: ________ |
| Speech model in use | ☐ Whisper Base &nbsp;&nbsp; ☐ Whisper Small &nbsp;&nbsp; ☐ Whisper Large v3 Turbo |
| Date / time (Asia/Calcutta) | |

## PC B — Windows 11

| Field | Fill in |
| --- | --- |
| PC name | |
| `winver` (build ≥ 22000) | |
| Mic type | |
| Install type this run | ☐ Clean install &nbsp;&nbsp; ☐ Upgrade over previous WinFynd |
| Build under test | ☐ v0.1.1 release &nbsp;&nbsp; ☐ v0.2.0 test build: ________ |
| Speech model in use | ☐ Whisper Base &nbsp;&nbsp; ☐ Whisper Small &nbsp;&nbsp; ☐ Whisper Large v3 Turbo |
| Date / time (Asia/Calcutta) | |

Run **every numbered step on both PCs** unless a step says otherwise. Mark **Pass / Fail** and a short note.

---

## 0. Preconditions

### 0.1 OS build
1. Press Win+R → type `winver` → Enter.  
   **Expected:** Win10 shows a 10.0 build (e.g. 19045); Win11 shows build ≥ 22000.  
   **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

### 0.2 Microphone hardware
2. Confirm a working mic is connected (Windows Sound settings can hear you).  
   **Expected:** Windows input level moves when you speak.  
   **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

### 0.3 Windows mic privacy (desktop apps)
3. Open **Settings → Privacy & security → Microphone** (wording may vary slightly by Windows build). Turn **on** access for desktop apps / let apps access your microphone.  
   **Expected:** Desktop-app microphone access is allowed before testing WinFynd.  
   **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

### 0.4 Install WinFynd
4. Install from the GitHub release installer (`WinFynd-Setup-0.1.1.exe` for the current release). Unsigned: SmartScreen may require **More info → Run anyway**. Prefer one **clean** install and one **upgrade** pass if you already had WinFynd.  
   **Expected:** Installs under `%LOCALAPPDATA%\WinFynd`; tray icon appears; About shows the version under test.  
   **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

### 0.5 Speech model on and downloaded
5. Finish setup with **"Also search speech in recordings and videos"** checked (downloads Whisper Small), **or** open Settings → **Models** → **Speech** → **Download**, wait until the card shows **"In use"** (not just installed). Confirm Settings → **Folders** → **"Speech in recordings and videos"** is on.  
   **Expected:** Speech card shows the model label (e.g. **"Whisper Small"**) with **"In use"**; folder speech toggle is on. Offline after download is fine; first download needs network to huggingface.co.  
   **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

### 0.6 Mic check in WinFynd
6. Settings → **Shortcuts & voice** → **"Test your microphone"** → **Test**. Speak.  
   **Expected:** Bars move; subtitle **"Say something. The bars should move."** Failure shows **"No microphone"**. First use may show a **WebView2 / Windows mic permission** prompt (no app-owned label in code — allow it).  
   **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

---

## 1. First use — model & permission

### 1.1 Fresh PC / no speech model
7. (Optional destroy-path) With speech off or model missing, open launcher (default **Alt+Space**), click **"Search by voice"** (mic button), speak, finish.  
   **Expected:** Error text exactly: **"Turn on speech on the Models page to talk to search."** or **"The speech model isn't downloaded yet."**  
   **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

### 1.2 Download progress
8. Settings → **Models** → **Speech** → **Download** (if not already).  
   **Expected:** Progress like **"Downloading · … of …"** or **"Starting the download…"**. On failure: **"The download stopped: …"** (setup may say **"Whisper didn't download: …"**). File appears under `%APPDATA%\app.winfynd.desktop\speech\`.  
   **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

### 1.3 First mic permission from launcher
9. With speech **In use**, open launcher → click mic (**"Search by voice"**). If Windows/WebView2 asks for the mic, **Allow**.  
   **Expected:** Voice bar appears; hint **"Listening. Press Enter or click the mic to search."**; badge **"Speech stays on this PC"**; heard area shows **"Say what you're looking for"** until words appear. Deny path is step 14.  
   **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

---

## 2. Happy path

Use **hold** mode (default): Settings → **Shortcuts & voice** → **"How talking works"** → **"Hold the shortcut while you speak"**. Shortcut row **"Talk to search"**.

### 2.1 Short English query (hold)
10. Hold **Alt+Shift+Space**, say clearly: **"find my resume"**, release.  
    **Expected:** While held: **"Listening. Release … to search."** Level bars move. On release: **"Turning what you said into words on this PC…"**, then search box fills with a close transcript and search runs (results or empty-state). Not the **"Didn't catch anything…"** note.  
    **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

### 2.2 File-name style query
11. Hold voice keys, say a real file name on this PC (e.g. **"quarterly budget spreadsheet"** or an exact `.pdf` / `.docx` name you know exists), release.  
    **Expected:** Transcript lands in the search box (`aria-label` **"Search your files"** / placeholder **"Search files, photos and recordings"**); search runs; relevant hit appears if indexed.  
    **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

### 2.3 Mic-button path
12. Click **"Search by voice"**, say **"photos from last week"**, press **Enter** or click the lit mic (**"Stop and search"**).  
    **Expected:** Same listen → transcribe → query fill → search flow; hint uses Enter/mic wording above.  
    **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

### 2.4 Toggle mode
13. Set **"Press once to start, press again to stop"**. Press voice keys, speak, press again.  
    **Expected:** Hint **"Listening. Press … again to search."**; second press transcribes and searches.  
    **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

---

## 3. Edge cases

### 3.1 Deny microphone access
14. In Windows Privacy, turn **off** mic for desktop apps (or deny the WebView2 prompt). Try voice.  
    **Expected:** Error: **"Windows didn't give WinFynd the microphone. Turn it on in Settings, Privacy & security, Microphone."** Re-enable after the step.  
    **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

### 3.2 No microphone
15. Disable or unplug all mics; try **"Test your microphone"** and launcher voice.  
    **Expected:** Test shows **"No microphone"**; launcher voice hits the same Windows-mic error (or fails open). Restore mic after.  
    **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

### 3.3 Noisy room
16. With TV/fan noise, hold voice keys and say a short clear phrase.  
    **Expected:** Prefer usable transcript; if empty, note **"Didn't catch anything. Hold the voice keys, say what you're looking for, then let go."** (toggle/click variants differ). Record how bad the transcript is.  
    **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

### 3.4 Long speech (~25–30 s)
17. Hold and speak until the app stops on its own (~30 s max in code).  
    **Expected:** Auto-stop → transcribing → text in search box (may be long). App should not hang; if UI freezes, note and grab the log.  
    **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

### 3.5 Cancel mid-recording
18. Start listening (hold or click), speak a few words, press **Esc** (or click away so the launcher blurs).  
    **Expected:** Listening ends **without** filling the search box or running search.  
    **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

### 3.6 Offline (after model downloaded)
19. Disconnect network. Run a short voice search.  
    **Expected:** Still works (local Whisper). First-time **Download** while offline must fail with a download error — that is separate.  
    **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

### 3.7 Non-English / accent
20. Code sets Whisper language to **`auto`** on multilingual models. Say a short query in another language you speak, and/or English with a strong accent.  
    **Expected:** Some usable transcript is allowed; empty or garbage → Fail for that language/accent and note it. (No separate language UI exists.)  
    **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

### 3.8 Switch microphone device
21. Settings → **Shortcuts & voice** → **"Microphone"** combo: leave **"Windows default"**, then pick a named device (labels appear after mic was allowed; unnamed devices show as **"Microphone N"**). **Test**, then voice-search with each.  
    **Expected:** Chosen device is used (`localStorage` key `wf.mic`). After unplug/replug, device IDs may go stale — if voice breaks, set back to **"Windows default"** and retest.  
    **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

### 3.9 Speech toggle off (Folders)
22. Settings → **Folders** → turn **off** **"Speech in recordings and videos"**. Try voice search. Turn it back **on** (and **Use** the model on **Models** if needed).  
    **Expected:** Off → **"Turn on speech on the Models page to talk to search."** On again → voice works.  
    **Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

---

## 4. On failure — what to capture

For every Fail, collect:

1. **Screenshot** of the launcher (error / voice bar / wrong transcript) and of Settings → **About** showing **"Version …"**.  
2. **Log:** `%LOCALAPPDATA%\app.winfynd.desktop\logs\winfynd.log` (and `winfynd.old.log` if present). Paste path into Explorer address bar.  
3. **Speech model file present?** `%APPDATA%\app.winfynd.desktop\speech\` (e.g. `ggml-small.bin`).  
4. **Repro notes:** OS (`winver`), clean vs upgrade, hold/toggle/click, exact words spoken, online/offline, mic device name.  
5. **Windows mic privacy** screenshot (desktop-app access on/off).

---

## 5. Go / no-go for shipping voice in v0.2.0

**GO** only if **both** Windows 10 and Windows 11 pass:

- Preconditions 0.1–0.6  
- First-use permission (1.3) and happy path 2.1–2.3  
- Deny-mic error text (3.1)  
- Cancel (3.5)  
- Offline after download (3.6)  
- No hang/crash on ~30 s speech (3.4)  
- Transcript is good enough that a clear English file-name query finds the intended file when that file is indexed (2.2)

**NO-GO** (block shipping voice in v0.2.0) if any of:

- Voice cannot obtain the mic on a normal privacy setup, or the wrong error is shown  
- With speech **"In use"**, transcription never fills the search box on a clear short English phrase  
- App hangs, crashes, or leaves the mic open after Esc/blur  
- Speech download cannot complete on a normal network, with no clear **"The download stopped: …"** / **"Whisper didn't download: …"** message  

**Defer (ship voice but document):** noisy-room accuracy, non-English quality, Large model speed, stale mic device IDs after unplug — note in release notes; do not block if GO criteria above pass.

| Decision | Win10 | Win11 |
| --- | --- | --- |
| GO / NO-GO | | |
| Tester sign-off | | |
| Date (Asia/Calcutta) | | |

---

## Code risks most likely to bite on Windows

1. **Speech is optional and easy to leave off** — empty `speech_model` or Folders toggle off yields **"Turn on speech on the Models page…"** even though the mic UI works.  
2. **Mic is WebView2 `getUserMedia`**, not a Tauri capability; Windows Privacy + the WebView permission prompt both must allow it (`capabilities/default.json` has no mic permission; CSP is `null`).  
3. **First Whisper download needs Hugging Face** (~148–574 MB); unsigned installer + SmartScreen is a separate first-run hurdle.  
4. **Interim transcription every ~1.8 s while listening** can stress CPU (especially Large); watch for UI stalls on older Win10 PCs.  
5. **Chosen mic ID is stored in `localStorage` (`wf.mic`)** and can go stale after replugging devices — prefer **"Windows default"** if voice suddenly fails.  
6. **Audio graph connects the ScriptProcessor to `ctx.destination`** — on some Windows audio stacks listen for echo/feedback while the voice bar is up.

