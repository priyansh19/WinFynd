# WinFynd v0.2.0 go / no-go checklist

Real PCs only. CI does not cover this. The build under test is the `WinFynd-Setup-0.2.0.exe` attached to the draft release (or a Release-workflow artifact of that same commit), plus the `SHA256SUMS.txt` from the same place.

Run every numbered step on each machine below, unless the step says otherwise. Quote what you saw. Do not invent a label that was not on screen.

| Machine | OS | Required |
| --- | --- | --- |
| PC A | Windows 10 **22H2** (x64, `winver` 19045) | Yes |
| PC B | Windows 11 **23H2** (x64) | One of PC B or PC C is required. Run both when you have them. |
| PC C | Windows 11 **24H2** (x64) | One of PC B or PC C is required. Run both when you have them. |

A Win11 build that you do not have is "not run", not a pass. If you do run both 23H2 and 24H2, both have to pass.

Voice search ships in v0.2.0. The voice steps are a regression, not a decision to hide the feature. The full voice script is [voice-checklist.md](voice-checklist.md).

Each PC does two install passes. Use a test folder that lives outside WinFynd's own data (for example `C:\WinFyndQA`), so uninstall cannot eat it.

1. **Upgrade pass.** Start from the published [WinFynd 0.1.1](https://github.com/priyansh19/WinFynd/releases/tag/v0.1.1) installer with an index that already finds a known file. Then install 0.2.0 over it.
2. **Clean pass.** Uninstall 0.2.0 with **"Also delete my search index and settings"** ticked, confirm the leftovers check, then install 0.2.0 on a PC that has no WinFynd left.

If the PC has no 0.1.1 yet, do the clean pass first, uninstall with that box ticked, install 0.1.1, build the index, then do the upgrade pass.

## Machines

Fill one block per PC before testing.

### PC A — Windows 10 22H2

| Field | Fill in |
| --- | --- |
| PC name | |
| `winver` (expect 19045.xxxx) | |
| Pass | ☐ Clean install &nbsp;&nbsp; ☐ Upgrade from 0.1.1 |
| Build (About version string) | |
| Date / time (Asia/Calcutta) | |

### PC B — Windows 11 23H2

| Field | Fill in |
| --- | --- |
| PC name | |
| `winver` | |
| Pass | ☐ Clean install &nbsp;&nbsp; ☐ Upgrade from 0.1.1 |
| Build (About version string) | |
| Date / time (Asia/Calcutta) | |

### PC C — Windows 11 24H2

| Field | Fill in |
| --- | --- |
| PC name | |
| `winver` | |
| Pass | ☐ Clean install &nbsp;&nbsp; ☐ Upgrade from 0.1.1 |
| Build (About version string) | |
| Date / time (Asia/Calcutta) | |

## Test folder

Put these in `C:\WinFyndQA` (names can differ; write the names you used in the notes):

| File | What to put in it |
| --- | --- |
| A `.txt` or `.docx` | A sentence that appears nowhere else, e.g. `purple badger ledger 4817` |
| A text-layer PDF | A different unique sentence |
| A photo | Something you can describe in words (a receipt, a pet, a sunset) |
| An English screenshot | A unique phrase **only in the picture**, not in the file name. Note whether an English OCR language pack is installed |
| The same document copied | A second copy of the txt/docx in `C:\WinFyndQA\copies\` |
| A file with a distinctive name | e.g. `quarterly-budget.xlsx` |
| An audio file | You speaking a unique phrase |
| A video file | You speaking a unique phrase, and a frame that shows something not said aloud (a handwritten word, a sign) |

**Expected:** The folder is ordinary user files. WinFynd did not create it.  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

---

## 1. SHA256 of the installer

Do this before the first run on each PC. In PowerShell, from the folder that contains both files:

```powershell
Get-Content .\SHA256SUMS.txt
Get-FileHash .\WinFynd-Setup-0.2.0.exe -Algorithm SHA256
```

**Expected:** `SHA256SUMS.txt` has one line, the lowercase SHA-256, two spaces, then `WinFynd-Setup-0.2.0.exe`. `Get-FileHash` prints the same hash (case does not matter). A missing sums file, a second hash, or a mismatch is Fail. Do not run the exe.  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

## 2. SmartScreen — Run anyway

1. Double-click `WinFynd-Setup-0.2.0.exe`.

**Expected:** Microsoft Defender SmartScreen shows **Windows protected your PC**. **More info**, then **Run anyway**, opens WinFynd Setup. The app name shown is `WinFynd-Setup-0.2.0.exe`. Publisher is unknown. **Don't run** stops the test; that click is not a pass.  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

## 3. Clean install

On a Windows user account with no WinFynd install (no `%LOCALAPPDATA%\WinFynd`, no uninstall key).

1. Finish setup from the SmartScreen step.
2. Open Settings → **About**.

**Expected:** No admin prompt (UAC consent for elevation does not appear). Files land in `%LOCALAPPDATA%\WinFynd`. A tray icon with tooltip **WinFynd** is present. About shows **Version 0.2.0**. The process keeps running after you close Settings.  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

## 4. First-run onboarding

On the clean install, before searching.

1. Walk the setup window: welcome (**Find anything on your PC by describing it.**), **Choose what to search**, **Download the search model**, **One shortcut, from any app**, **Warming up**, **You're all set**.
2. Point **Choose what to search** at `C:\WinFyndQA` only. Leave the rest of the PC out of this pass so the spot checks stay small.
3. Let the search-model download finish.

**Expected:** You can move Back and forward. The model download finishes or shows a real error (record the text). Setup does not close itself on a failed download and then claim the PC is ready. After **You're all set**, Alt+Space opens the launcher.  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

## 5. Upgrade from 0.1.1 with an existing index

On a PC that already has 0.1.1, not on the clean-install account until 0.1.1 has been installed there on purpose.

1. On 0.1.1, index `C:\WinFyndQA` and confirm the unique document sentence finds that file. Note the folders and shortcuts you set.
2. Quit is not required. Run `WinFynd-Setup-0.2.0.exe` over 0.1.1 (SmartScreen as in step 2 if it appears).
3. When setup finishes, open About and search for the same sentence.

**Expected:** About shows **Version 0.2.0**. `%APPDATA%\app.winfynd.desktop` still exists after setup (setup does not delete it). The folders and shortcuts from 0.1.1 are still the ones you set. The known file is found again, either immediately or after the background read finishes. Your files in `C:\WinFyndQA` are unchanged. A demand to pick folders again, an empty index with no re-read, or a search that never finds the known file is Fail.  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

## 6. Index the test folder

1. Settings → **Folders**. Confirm `C:\WinFyndQA` is included.
2. Wait until the launcher is no longer reporting that the first read is still running (the note under the empty search box).

**Expected:** The txt/docx, PDF, photo, screenshot, audio file and video file are all eligible. A file that never leaves the queue, or a pass that ends with an error and a zero count, is Fail. Record the final count.  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

## 7. Search spot checks

Open the launcher with **Alt+Space**. Placeholder is **Search files, photos and recordings**.

1. Search the unique sentence from the txt/docx.
2. Search the unique sentence from the PDF.
3. Search a description of the photo (**What's in photos** on, and the Text and photos / Balanced or Most accurate model — not **Text only**).

**Expected:** Each query returns the file you prepared. The document hits show the sentence (or the page) that matched. The photo hit is that photo, not a random image. A name-only hit is a pass for the document name and a Fail for the photo description if the picture itself was the only clue.  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

## 8. Typo-tolerant file names

1. Search a small misspelling of the distinctive file name, with the real name not typed. Example: file `quarterly-budget.xlsx`, query `quaterly budget`.

**Expected:** That file is in the results. Record the query and the row you got. If only the exact name matches, Fail.  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

## 9. Screenshot OCR — English

1. Confirm an English OCR language pack is installed on this Windows (Windows Settings language / OCR features; the exact Windows page title varies by build — record it).
2. Search the unique phrase that exists only inside the screenshot, not in its file name.

**Expected:** The screenshot is a hit because of the words in the image. A hit that only matches the file name does not count. Record the query.  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

## 10. Screenshot OCR — no language pack

1. Remove the English OCR language pack, or use an account where it was never installed. Record which you did.
2. Search the same in-image phrase again. Then search the screenshot's file name.

**Expected:** WinFynd does not crash and does not hang the launcher. The in-image phrase is not required to match. The file name still finds the screenshot. Record the on-screen text if the app explains the missing pack. A crash, a stuck launcher, or a wrong file presented as the phrase hit is Fail.  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

Put the language pack back before you call the rest of the machine done, if later steps need it.

## 11. Duplicate copies shown once

1. Search the unique sentence that is in both copies of the same document.

**Expected:** One result, not two rows for the two paths. Record how the single result is shown (one path, or both paths on one row). Two rows is Fail.  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

## 12. Ask with Ollama

1. Install and start Ollama. Pull a chat model (any chat model; the app does not require a specific one). Settings → **Models** should show **Ollama is running**.
2. Open Ask with **Ctrl+Alt+Space**, or the **Ask a question** shortcut from Settings → **Shortcuts & voice**. Placeholder: **Ask a question about your files**.
3. Ask a question whose answer is only in the test document.

**Expected:** The answer is written on this PC. It cites the test file (numbered sources). It does not answer as if it had no files when the passage is indexed.  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

## 13. Ask without Ollama

1. Quit Ollama so nothing is listening on `127.0.0.1:11434`.
2. Ask the same question again.

**Expected:** No sourced answer is shown. The launcher reports an error. When Ollama is down the engine says **Ollama isn't running. Install it from ollama.com and start it.** When Ollama is up but has no chat model it says **No chat model is installed in Ollama. Pull one (for example gemma4) to use Ask mode.** Ordinary search (Alt+Space, not Ask) still finds the test document by its sentence. Start Ollama again after this step.  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

## 14. Whisper on an audio file

1. Settings → **Models** → **Speech**: **Download** a model if none is installed, then **Use** it so the card says **In use** (not only installed).
2. Settings → **Folders** → **Speech in recordings and videos** is on.
3. Wait until the audio file has been read.
4. Search the unique phrase you spoke.

**Expected:** The audio file is a hit. The preview is the recording, at the moment the phrase was said (a timestamp, not only the file name). Speech stays on this PC: disconnecting the network after the model is downloaded still returns the hit.  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

## 15. Whisper on a video file

1. With the same Speech model **In use**, search the unique phrase spoken in the video.

**Expected:** The video is a hit for the spoken phrase. The preview can play from that moment. A hit that only matches the file name is Fail.  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

## 16. FFmpeg video-frame search

1. Install FFmpeg (`winget install Gyan.FFmpeg`) and restart WinFynd if the Models page does not see it yet.
2. Settings → **Models** → **FFmpeg** shows **Found** (and a version when Windows reports one).
3. Settings → **Folders** → **What's in photos** on, and **Frames in videos** on.
4. Re-read the video if it was indexed before FFmpeg was available.
5. Search words that describe only the on-screen moment, not the spoken phrase and not the file name.

**Expected:** The video (or that moment) is a hit. Then turn **Frames in videos** off, or uninstall FFmpeg and restart: the Models card no longer says **Found**, frame search is not offered as working, and the app still searches file names and speech. A crash with FFmpeg missing is Fail.  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

## 17. Tray

1. Close Settings and the launcher.
2. Left-click the tray icon.
3. Right-click it. The menu items are **Open WinFynd**, **Settings**, **Run setup again**, **Quit WinFynd**.

**Expected:** The process is still running with the windows closed. Left-click toggles the launcher. **Settings** opens Settings. **Quit WinFynd** exits, and the icon is gone. Start WinFynd again from the Start menu before the next step.  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

## 18. Hotkeys

Defaults from a fresh setup (an upgrade keeps whatever 0.1.1 had — test the keys that are actually set, and write them down):

| Action | Default |
| --- | --- |
| Open the launcher | Alt+Space |
| Voice search | Alt+Shift+Space |
| Ask a question | Ctrl+Alt+Space |
| Search selected text | Win+Shift+F |

1. From another app (Explorer or Notepad), press the launcher shortcut.
2. Press the Ask shortcut.
3. Highlight a unique word from the test document in Notepad and press the selection shortcut.

**Expected:** The launcher opens over the other app. Ask opens with **Ask a question about your files**. The selection shortcut searches that word. Keys do nothing only if Windows reserved them; record the conflict. A shortcut that opens the wrong mode is Fail.  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

## 19. Voice regression

Voice search is in this release. Run every numbered step in [voice-checklist.md](voice-checklist.md) on this PC against the v0.2.0 build. That file has the expected result and the Pass/Fail line for each step.

**Expected:** This PC meets the GO list in that file: preconditions 0.1–0.6, first-use permission (1.3), happy path 2.1–2.3, deny-mic error text (3.1), cancel (3.5), offline after download (3.6), no hang on about 30 seconds of speech (3.4), and a clear English file-name query finds the indexed file (2.2).  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

## 20. Uninstall leaves no leftovers

1. Confirm `C:\WinFyndQA` is still intact. Copy down one file size.
2. Settings or the Start menu → uninstall. In the WinFynd window, tick **Also delete my search index and settings**. Uninstall.
3. In PowerShell:

```powershell
Get-Process WinFynd -ErrorAction SilentlyContinue
Test-Path "$env:LOCALAPPDATA\WinFynd"
Test-Path "$env:APPDATA\app.winfynd.desktop"
Test-Path "$env:LOCALAPPDATA\app.winfynd.desktop"
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WinFynd' -ErrorAction SilentlyContinue
(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).WinFynd
Get-Item C:\WinFyndQA\<one-test-file>
```

**Expected:** No `WinFynd` process and no tray icon. The install folder, both `app.winfynd.desktop` data folders, the uninstall registry key, and the Run value `WinFynd` are gone. The test file is still there, same size. Your documents outside that folder are untouched.

Unticked box (separate note, not this step's pass): the app folder and uninstall key go away, and the two data folders remain. Do not use the unticked box as the leftovers pass.  
**Pass / Fail / Notes:** ☐ Pass &nbsp; ☐ Fail &nbsp; ________________

---

## Go / no-go

**GO** only when Windows 10 22H2 and a Windows 11 23H2 or 24H2 PC each pass all of the following. If both Win11 builds were tested, both must pass:

- SHA256 matches `SHA256SUMS.txt` (step 1), on both the upgrade installer and the clean installer if they are different files
- SmartScreen **More info** → **Run anyway** (step 2)
- Clean install, About **Version 0.2.0**, tray stays up (step 3)
- First-run onboarding finishes and Alt+Space opens search (step 4)
- Upgrade from 0.1.1 keeps the index and the known file is found (step 5)
- Test folder indexed (step 6) and the document, PDF and photo spot checks (step 7)
- Typo-tolerant name (step 8)
- English screenshot OCR (step 9) and no-language-pack behaviour (step 10)
- Duplicate copies shown once (step 11)
- Ask with Ollama (step 12) and the Ollama-down error (step 13)
- Whisper on audio (step 14) and on video (step 15)
- FFmpeg frame search, and no crash without it (step 16)
- Tray menu and quit (step 17)
- Hotkeys (step 18)
- Voice regression GO on that PC ([voice-checklist.md](voice-checklist.md), step 19)
- Uninstall with the delete-data box leaves the paths in step 20 gone and the test files in place

**NO-GO** if Windows 10 22H2 was not tested, if neither Windows 11 23H2 nor 24H2 was tested, if any step above fails on a machine you did run, if the app crashes, if the upgrade loses the 0.1.1 index, if uninstall deletes `C:\WinFyndQA`, or if the installer hash does not match `SHA256SUMS.txt`.

A noisy-room or non-English voice miss that the voice checklist marks as defer does not block, as long as that file's GO list passed.

| | Win10 22H2 | Win11 23H2 | Win11 24H2 |
| --- | --- | --- | --- |
| GO / NO-GO | | | |
| Tester | | | |
| Date (Asia/Calcutta) | | | |

Priyansh publishes the draft only after this table is GO on all three builds. Publishing steps: [docs/RELEASING.md](../RELEASING.md).
