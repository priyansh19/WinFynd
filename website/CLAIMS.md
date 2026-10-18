# Claims that depend on unbuilt app work

The site describes WinFynd 0.1.0 as it will ship. A few features on these pages were designed for the MVP and are still being built by the app team. Every sentence or product visual that depends on one of them is listed here, so it can be checked against the real app before 0.1.0 is published. If a feature slips, change or remove the sentence before release.

How to use it:

- Before release, go through every row and mark it **Verified** (works in the release build) or fix the page.
- When you add a sentence or visual that depends on unbuilt work, add a row under its page.
- Sources point at the facts sheet (`facts.md`, section 10) and the design canvas (`Scope.dc.html`, the scope board).

Status values: **Being built** (designed for 0.1.0, not in the code yet), **Verified** (checked in a release build).

## Home (`index.html`)

| Where on the page | Exact sentence or visual | Depends on | Status |
|---|---|---|---|
| Shortcuts, "Talk" card | "Hold the keys, say what you're looking for, then let go." (Alt + Shift + Space) | Voice search turning speech into the query. The shortcut, listening UI and mic level work today; the speech is not yet turned into a search (`src/launcher/Voice.tsx:5-9`, Scope board "Talk to search"). | Being built |
| Privacy, lead | "Reading, search, answers and voice all run on this PC." | The word "voice": voice search speech-to-text on the PC (same feature as above). Reading, search and answers are built. | Being built |
| Shortcuts, "Search the selection" card | "Select text in any app and find the files about it." (Win + Shift + F) | Win + Shift + F reading the selected text. Today it only opens the launcher (`src/launcher/Launcher.tsx:115`, Scope board "Search selected text"). | Being built |
| Privacy, "Every connection listed" | "Settings shows all three: Ollama on this PC, model downloads when you click Download, and a daily update check you can turn off." | The Privacy page in Settings (Scope board "Privacy and About pages") and the daily update check from GitHub releases with an off switch (no code yet; `SettingsPrivacy.dc.html:38`, Scope board "Check for updates"). | Being built |
| Privacy, product visual | The "WinFynd Settings" Privacy page: "Your files never leave this PC" banner and the Connections list (Ollama, Model downloads, Update check "Once a day, can be turned off"). | The Privacy settings page and the daily update check (as above). If the update check does not ship, remove its row from the visual and change the promise to "both". | Being built |
| Hero demo and "It reads what's inside", Documents | Rendered PDF page in the preview with the matched words highlighted, and the "Words: sofa, navy" / "Meaning: a receipt" chips. | Rendered previews with highlighted words and match chips (Scope board "Search box, grouped results, preview and actions"; `Review.dc.html:25,27`). Today the preview shows the matching passage with its page label and an Explorer thumbnail. | Being built |
| Hero demo and "It reads what's inside", Photos | The "Looks like: dog, beach, sunset" chip under a photo. | The same match chip, for photos. Today the reason reads "Image matches your search". | Being built |
| Hero demo, Recording | The waveform panel with "Play from 12:05" in the preview. | The restyled audio preview. Playing from the matched second is built (`src/launcher/Preview.tsx`); the waveform and button styling are design. | Being built |
| Live index, product visual | The Settings window with the progress ring, the indexing feed whose finished files flash their kind colour, and the "Read so far" counts by kind. | The live indexing corner with kind colours and the done pop, and the new Settings Home with progress (Scope board "Live indexing corner" and "Home, Folders, Models, Shortcuts & voice"). Watching folders, reading new files within seconds and the tray progress are built. | Being built |
| All launcher and Settings visuals | The WinFynd Fluent look: Acrylic launcher, kind colours, spectrum progress. | The theme being applied to the launcher, Settings, setup and installer (Scope board rows marked "Apply this design"). | Being built |

Already built, no row needed: Alt + Space search, Ctrl + Alt + Space Ask with numbered sources, Enter opens the file, the preview playing audio or video from the matched second, changing shortcuts in Settings, the "WinFynd is ready" notification (its text on the page matches the code), per-user install without an admin prompt.

## How it works (`how-it-works.html`)

| Where on the page | Exact sentence or visual | Depends on | Status |
|---|---|---|---|
| Hero, product visual | Launcher preview showing the rendered PDF page with "sofa, navy" and "Total paid" highlighted, and the "Words: sofa, navy" / "Meaning: a receipt" chips. | Page previews with highlighted words and the words/meaning chip (Scope board "Search box, grouped results, preview and actions"; `Review.dc.html:25,27`). Today the preview shows the matching passage with its page label and an Explorer thumbnail. | Being built |
| Hero, product visual; First run, Welcome visual | Photo result line "Looks like a printed receipt" under IMG_2041.jpg. | The photo match chip/reason text. Today the reason reads "Image matches your search" (the Search step visual already uses the code's text). | Being built |
| "Two ways to match. It tells you which." | The launcher visual with "Words: sofa, navy", "Meaning: a receipt" and "Words: sofa" chips labelled Both / Meaning only / Words only, and the copy explaining the two chips. | The words/meaning chip in the launcher (same as the hero row). The built reasons ("Exact words on page N", "Matches the meaning", "Image matches your search") already say which kind of match it was. | Being built |
| Step 1 "Watch", visual | "Watching 3 folders" with per-kind bars and a feed whose finished files flash their kind colour. | The live indexing corner with kind colours (Scope board "Live indexing corner"). Watching folders and reading changes within seconds are built. | Being built |
| Models, Whisper Small | "Speech in recordings, videos and voice search" (card title line and the visual "Recordings, videos and voice search · 466 MB"). | Voice search speech-to-text (`src/launcher/Voice.tsx:5-9`, Scope board "Talk to search"). Speech in recordings and videos is built. | Being built |
| First run, Welcome visual | "Type or say what you remember." and "Your files, searches and voice stay on this PC." | The word "say" / "voice": voice search speech-to-text (as above). | Being built |
| First run, Warm-up visual | Counts by kind (Documents, Photos, Recordings and so on) that count up while each finished file flashes its kind colour. | The setup Warm-up in the new design with kind colours (Scope board rows "Live indexing corner" and "Apply this design"). The Warm-up step itself (close and finish in the background) is built. | Being built |
| All launcher, Settings and setup visuals | The WinFynd Fluent look: Acrylic launcher, kind colours, spectrum progress, the restyled setup window and Settings model cards. | The theme being applied to the launcher, Settings and setup (Scope board rows marked "Apply this design"). | Being built |
