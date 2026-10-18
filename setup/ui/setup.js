// WinFynd Setup window. Plain script: Tauri injects window.__TAURI__ (withGlobalTauri).
// Opened in a browser it runs on mock data, e.g. index.html?mode=update&screen=progress.

const tauri = window.__TAURI__;
const $ = (id) => document.getElementById(id);

// 20 x 20 icons from the WinFynd Fluent set.
const ICONS = {
  done: '<circle cx="10" cy="10" r="7.5"/><path d="M6.8 10.2l2.2 2.2 4.2-4.6"/>',
  failed: '<circle cx="10" cy="10" r="7.5"/><path d="M7.5 7.5l5 5M12.5 7.5l-5 5"/>',
  info: '<circle cx="10" cy="10" r="7.5"/><path d="M10 9v5M10 6.2v.1"/>',
  lock: '<rect x="4" y="9" width="12" height="8.5" rx="1.5"/><path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9"/>',
};

const TAGLINE = "Find anything on your PC by describing it.";

let state;
let steps = [];
let creep;

// --- Backend ----------------------------------------------------------------

const mock = (() => {
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") || "install";
  return {
    screen: params.get("screen"),
    state: {
      mode,
      version: "0.2.0",
      installedVersion: mode === "install" ? null : mode === "newer" ? "0.3.0" : mode === "reinstall" ? "0.2.0" : "0.1.0",
      installDir: "C:\\Users\\gupta\\AppData\\Local\\WinFynd",
      running: mode === "update",
      autostart: true,
      dataBytes: 2.3e9,
      appBytes: 38e6,
      accentLight: null,
      accentDark: null,
    },
  };
})();

function invoke(cmd, args) {
  if (tauri) return tauri.core.invoke(cmd, args);
  if (cmd === "get_state") return Promise.resolve(mock.state);
  return new Promise((resolve) => setTimeout(resolve, 3000));
}

function onStep(handler) {
  if (tauri) tauri.event.listen("step", (e) => handler(e.payload));
}

function closeWindow() {
  if (tauri) tauri.window.getCurrentWindow().close();
}

function minimizeWindow() {
  if (tauri) tauri.window.getCurrentWindow().minimize();
}

// --- Rendering --------------------------------------------------------------

function show(screen) {
  document.body.dataset.screen = screen;
}

// The coloured band at the top of the window.
function hero(title, subtitle) {
  $("title").textContent = title;
  $("subtitle").textContent = subtitle || "";
  $("subtitle").hidden = !subtitle;
}

function text(id, value) {
  $(id).textContent = value || "";
  $(id).hidden = !value;
}

function buttons(primary, secondary) {
  const set = (el, spec) => {
    el.hidden = !spec;
    if (!spec) return;
    el.textContent = spec.label;
    el.disabled = !!spec.disabled;
    el.onclick = spec.action;
  };
  set($("primary"), primary);
  set($("secondary"), secondary);
}

// A short note at the left of the footer; `lock` puts the padlock in front of it.
function footer(note, lock) {
  const el = $("footer-note");
  el.textContent = note || "";
  if (note && lock) {
    el.insertAdjacentHTML("afterbegin", `<svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true">${ICONS.lock}</svg>`);
  }
}

function message(kind, heading, body, detail) {
  text("message-heading", heading);
  const icon = $("message-icon");
  icon.setAttribute("class", kind === "ok" ? "icon ok" : kind === "error" ? "icon danger" : "icon accent");
  icon.innerHTML = kind === "ok" ? ICONS.done : kind === "error" ? ICONS.failed : ICONS.info;
  $("message-card").className = `infobar ${kind === "ok" ? "" : kind === "error" ? "error" : "info"}`;
  $("message").textContent = body;
  text("message-detail", detail);
  show("message");
}

function formatBytes(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

// --- Progress ---------------------------------------------------------------

function startProgress(heading, list, tip) {
  steps = list.map((s) => ({ ...s, status: "pending" }));
  $("progress-heading").textContent = heading;
  $("progress").classList.remove("failed");
  $("progress").classList.add("live");
  $("progress-tip-text").textContent = tip || "";
  $("progress-tip").hidden = !tip;
  setProgress(0);
  renderSteps();
  footer("");
  // Stopping the installer halfway would leave a broken install, so Cancel stays off.
  buttons(null, { label: "Cancel", disabled: true, action: null });
  show("progress");
}

// One line under the bar: what is happening now, and how far along the steps are.
function renderSteps() {
  let index = steps.findIndex((s) => s.status === "active" || s.status === "failed");
  if (index < 0) index = steps.findIndex((s) => s.status === "pending");
  if (index < 0) index = steps.length - 1;
  const current = steps[index];
  const where = steps.length > 1 ? ` · step ${index + 1} of ${steps.length}` : "";
  $("progress-label").textContent = current ? `${current.label}${where}` : "";
}

function setProgress(percent) {
  $("progress-fill").style.width = `${percent}%`;
  $("progress").setAttribute("aria-valuenow", String(Math.round(percent)));
}

// Each step owns a slice of the bar. The installer reports nothing while it runs,
// so an active step eases toward the end of its slice and jumps there when done.
function updateStep({ id, status }) {
  const index = steps.findIndex((s) => s.id === id);
  if (index < 0) return;
  steps[index].status = status;
  renderSteps();
  const total = steps.reduce((sum, s) => sum + s.weight, 0);
  const before = steps.slice(0, index).reduce((sum, s) => sum + s.weight, 0);
  const start = (before / total) * 100;
  const end = ((before + steps[index].weight) / total) * 100;
  clearInterval(creep);
  if (status === "active") {
    let p = start;
    setProgress(p);
    creep = setInterval(() => setProgress((p += (end - 2 - p) * 0.06)), 300);
  } else if (status === "done") {
    setProgress(end);
  } else if (status === "failed") {
    $("progress").classList.add("failed");
  }
}

// Mock runs walk the steps so the screen can be previewed in a browser.
async function runMockSteps() {
  if (tauri) return;
  for (const s of steps) {
    updateStep({ id: s.id, status: "active" });
    await new Promise((r) => setTimeout(r, 700));
    updateStep({ id: s.id, status: "done" });
  }
}

// --- Install, update, reinstall ---------------------------------------------

function renderInstall() {
  const { mode, version, installedVersion, running } = state;
  const fresh = mode === "install";
  hero("WinFynd", TAGLINE);
  if (fresh) {
    text("install-heading", "");
    text("install-lede", "");
  } else if (mode === "update") {
    text("install-heading", `Update to version ${version}`);
    text("install-lede", `You have ${installedVersion}. Your index, folders, shortcuts and models are kept.`);
  } else {
    text("install-heading", `Reinstall version ${version}`);
    text("install-lede", `Version ${version} is already installed. Reinstalling repairs it and keeps your index, folders, shortcuts and models.`);
  }

  renderLocation();
  $("location-row").hidden = !fresh;
  $("autostart-row").hidden = !fresh;
  $("shortcut-row").hidden = !fresh;
  $("running-row").hidden = fresh || !running;
  $("autostart").checked = state.autostart;

  if (fresh) footer("No account. Nothing is uploaded.", true);
  else footer("");
  const label = fresh ? "Install" : mode === "update" ? "Update" : "Reinstall";
  // A fresh install closes from the title bar; an update offers "Not now".
  buttons({ label, action: install }, fresh ? null : { label: "Not now", action: closeWindow });
  show("install");
}

function renderLocation() {
  const size = state.appBytes ? ` · ${formatBytes(state.appBytes)}` : "";
  $("location").textContent = `${state.installDir}${size}`;
  $("location").title = state.installDir;
}

async function chooseFolder() {
  const picked = await invoke("choose_folder", { current: state.installDir });
  if (picked) {
    state.installDir = picked;
    renderLocation();
    $("location-label").textContent = "Install to";
  }
}

async function install() {
  const { mode } = state;
  const fresh = mode === "install";
  const wasRunning = state.running;
  hero("WinFynd", TAGLINE);
  startProgress(
    fresh ? "Installing WinFynd" : "Updating WinFynd",
    [
      { id: "prepare", label: "Unpacking WinFynd", weight: 1 },
      { id: "copy", label: fresh ? "Copying files" : "Closing WinFynd and replacing its files", weight: 8 },
      { id: "register", label: fresh ? "Adding WinFynd to Start and Apps" : "Checking the new version", weight: 1 },
    ],
    fresh
      ? "When this finishes, setup asks what to search. That takes about two minutes."
      : "Your index, folders, shortcuts and models stay as they are.",
  );
  const run = invoke("install", {
    options: { dir: state.installDir, autostart: $("autostart").checked, desktopShortcut: $("shortcut").checked },
  });
  runMockSteps();
  try {
    await run;
  } catch (error) {
    return failed("WinFynd isn't installed yet", error, renderInstall);
  }

  $("progress").classList.remove("live");
  if (fresh) {
    text("done-heading", "WinFynd is installed");
    $("next-steps").textContent = "It lives in the tray, next to the clock. When it opens, it asks what to search and sets up the search model on this PC.";
    $("open-row").hidden = false;
  } else {
    // Bring it back the way it was: running in the tray if it was running before.
    if (wasRunning) invoke("launch_app", { background: true }).catch(() => {});
    text("done-heading", `WinFynd is updated to version ${state.version}`);
    $("next-steps").textContent = wasRunning ? "It's running again in the tray, next to the clock." : "Your index, folders, shortcuts and models were kept.";
    $("open-row").hidden = wasRunning;
  }
  footer("");
  buttons({ label: "Finish", action: finish }, null);
  show("done");
}

async function finish() {
  if (!$("open-row").hidden && $("open-now").checked) {
    try {
      await invoke("launch_app", { background: false });
    } catch (error) {
      return failed("WinFynd is installed, but didn't open", error, null);
    }
  }
  closeWindow();
}

// --- Uninstall --------------------------------------------------------------

function uninstallSubtitle() {
  const parts = [];
  if (state.installedVersion) parts.push(`Version ${state.installedVersion}`);
  if (state.appBytes) parts.push(formatBytes(state.appBytes));
  return parts.join(" · ");
}

function renderUninstall() {
  hero("Uninstall WinFynd", uninstallSubtitle());
  $("delete-data-label").textContent = state.dataBytes
    ? `Also delete my search index and settings (${formatBytes(state.dataBytes)})`
    : "Also delete my search index and settings";
  footer("");
  buttons({ label: "Uninstall", action: uninstall }, { label: "Cancel", action: closeWindow });
  show("uninstall");
}

async function uninstall() {
  const deleteData = $("delete-data").checked;
  const list = [{ id: "remove", label: "Closing WinFynd and removing it", weight: 4 }];
  if (deleteData) list.push({ id: "data", label: "Deleting your index and settings", weight: 1 });
  startProgress("Uninstalling WinFynd", list, "Your own files are never touched. Models you downloaded with Ollama stay in Ollama.");
  const run = invoke("uninstall", { deleteData });
  runMockSteps();
  try {
    await run;
  } catch (error) {
    return failed("WinFynd wasn't fully uninstalled", error, renderUninstall);
  }
  message(
    "ok",
    "WinFynd is uninstalled",
    deleteData ? "Your index and settings were deleted too." : "Your index and settings are still in AppData.",
    deleteData ? "" : "Install WinFynd again and it picks up where you left off.",
  );
  buttons({ label: "Close", action: closeWindow }, null);
}

// --- Other states -----------------------------------------------------------

function failed(title, error, retry) {
  clearInterval(creep);
  $("progress").classList.remove("live");
  message("error", title, String(error), "");
  footer("");
  buttons({ label: "Close", action: closeWindow }, retry ? { label: "Try again", action: retry } : null);
}

function renderNewer() {
  hero("WinFynd", TAGLINE);
  message(
    "info",
    "WinFynd is up to date",
    `A newer version, ${state.installedVersion}, is already installed.`,
    `This setup has version ${state.version}. To go back to it, uninstall WinFynd first.`,
  );
  footer("");
  buttons(
    { label: "Open WinFynd", action: () => invoke("launch_app", { background: false }).then(closeWindow, (e) => failed("WinFynd didn't open", e, null)) },
    { label: "Close", action: closeWindow },
  );
}

function renderSimple(heading, body, detail) {
  hero("WinFynd", TAGLINE);
  message("info", heading, body, detail);
  footer("");
  buttons({ label: "Close", action: closeWindow }, null);
}

// --- Start ------------------------------------------------------------------

document.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName;
  if (e.key === "Enter" && tag !== "BUTTON" && !$("primary").hidden && !$("primary").disabled) $("primary").click();
  if (e.key === "Escape" && !$("secondary").hidden && $("secondary").textContent !== "Try again") $("secondary").click();
  else if (e.key === "Escape" && $("secondary").hidden && document.body.dataset.screen !== "progress") closeWindow();
});

async function start() {
  state = await invoke("get_state");
  onStep(updateStep);
  $("change").onclick = chooseFolder;
  $("cap-min").onclick = minimizeWindow;
  $("cap-close").onclick = closeWindow;

  switch (state.mode) {
    case "install":
    case "update":
    case "reinstall":
      renderInstall();
      break;
    case "newer":
      renderNewer();
      break;
    case "uninstall":
      renderUninstall();
      break;
    case "notInstalled":
      renderSimple("WinFynd isn't installed", "There's nothing to uninstall on this PC.", "");
      break;
    default:
      renderSimple("WinFynd uninstaller", "This program removes WinFynd.", "To install WinFynd, run WinFynd Setup.");
  }

  // Browser previews can jump straight to a later screen.
  if (!tauri && mock.screen === "progress") (state.mode === "uninstall" ? uninstall : install)();
  if (!tauri && mock.screen === "done") install().then(() => {});

  if (tauri) tauri.window.getCurrentWindow().show();
}

start();
