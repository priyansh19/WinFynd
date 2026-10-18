# WinFynd website

The public site for WinFynd. Plain HTML, CSS and a little vanilla JavaScript: no build step, no framework, and no requests to anyone else (no web fonts, CDNs, analytics or external images). Every product visual is live HTML styled with `css/wf.css`, a copy of the app's own theme, so the pages look exactly like the app. The data in them is one realistic example PC (51,204 files in Documents, Pictures and Desktop).

## Pages

| File | Page |
|---|---|
| `index.html` | Home: the launcher demo, what WinFynd reads, Ask, the live index, privacy, shortcuts |
| `how-it-works.html` | How it works |
| `privacy.html` | Privacy: every connection the app makes and where data is stored |
| `download.html` | Download, system requirements, install, update and uninstall |
| `help.html` | Shortcuts, FAQ and troubleshooting |
| `changelog.html` | Changelog |
| `404.html` | Not found |

## Shared files

| Path | What it holds |
|---|---|
| `css/wf.css` | The app theme (WinFynd Fluent), scoped under `.wf`, plus a short website section at the end. Used for product shots only. |
| `css/site.css` | Site tokens, layout, header, footer, buttons, cards, sections, scroll reveal and page transitions. |
| `css/README-tokens.md` | The guide to the shared tokens and classes, with an example of each. Read it before writing a page. |
| `css/<page>.css`, `js/<page>.js` | Styles and behaviour for one page only. |
| `js/site.js` | Shared behaviour: the `.js` class, scroll reveal, header and mobile menu, shot fitting, and `WinFynd.whenActive` so demos run only while visible. |
| `partials/header.html`, `partials/footer.html` | The canonical header and footer. Paste them into every page (there is no include step), and update every page when they change. |
| `favicon.svg` | The app icon. |
| `CLAIMS.md` | Every sentence and visual that depends on app features still being built for 0.1.0. Check each row against the release build before publishing, and fix the page if a feature did not ship. |

Every page works with JavaScript turned off: content is only hidden for the scroll reveal when `site.js` has run, and the demos fall back to a finished, static state. With reduced motion, loops stop and reveals become plain fades.

## Preview

Open any `.html` file in a browser. To click between pages with the page transitions, serve the folder:

```sh
cd website
python3 -m http.server 8000
```

then open http://localhost:8000.

## Hosting

The site is hosted on Vercel. The Vercel project is imported at the repository root, and `vercel.json` there (in Vercel's services mode) deploys only this folder, as one public service named `website` that serves the whole domain. The desktop app (the root Vite UI and `src-tauri`) is never deployed: it runs on people's PCs and talks to its engine over Tauri IPC, not HTTP.

- Every push to `main` deploys the live site; every pull request gets a preview link.
- The `website` service turns on clean addresses (`/privacy` instead of `/privacy.html`) and sends security headers, including a Content-Security-Policy that only allows this site's own files, which backs the "loads nothing from anyone else" promise. `404.html` is served for any missing address.
- Keep Vercel Analytics and Speed Insights off: they would add third-party requests.

Any other static host works too: publish this folder as it is.

## Writing for the site

Say what WinFynd does, with a real example, in short sentences. No "open source" (the repository has no license yet; say "free, with its source on GitHub"), no em dashes, no exclamation marks, and no numbers that are not in the app or the example PC. Enter opens the file in its usual app; the launcher preview is what shows the matching page, slide or second.
