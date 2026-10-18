// WinFynd Setup window. Plain script: Tauri injects window.__TAURI__ (withGlobalTauri).
// Opened in a browser it runs on mock data, e.g. index.html?mode=update&screen=progress.

const tauri = window.__TAURI__;
const $ = (id) => document.getElementById(id);

const ICONS = {
  pending: '<circle cx="8" cy="8" r="5.5"/>',
  active: '<path d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5"/>',
  done: '<path d="M3 8.5l3.2 3L13 4.5"/>',
  failed: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.2v4M8 4.8v.4"/>',
};

const STEP_CLASS = { pending: "icon muted", active: "icon", done: "icon ok", failed: "icon danger" };

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
      dataBytes: 2.4e9,
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

// --- Rendering --------------------------------------------------------------

function show(screen) {
  document.body.dataset.screen = screen;
}

function hero(title, subtitle) {
  $("title").textContent = title;
  $("subtitle").textContent = subtitle || "";
  $("subtitle").hidden = !subtitle;
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

function footer(note) {
  $("footer-note").textContent = note || "";
}

function message(kind, text, detail) {
  const icon = $("message-icon");
  icon.setAttribute("class", kind === "ok" ? "icon ok" : kind === "error" ? "icon danger" : "icon muted");
  icon.innerHTML = kind === "ok" ? ICONS.done : kind === "error" ? ICONS.failed : ICONS.info;
  $("message").textContent = text;
  $("message-detail").textContent = detail || "";
  $("message-detail").hidden = !detail;
  show("message");
}

function formatBytes(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

// --- Progress ---------------------------------------------------------------

function startProgress(label, list) {
  steps = list.map((s) => ({ ...s, status: "pending" }));
  $("progress-label").textContent = label;
  $("progress-fill").parentElement.classList.remove("failed");
  setProgress(0);
  renderSteps();
  footer("");
  // Stopping the installer halfway would leave a broken install, so Cancel stays off.
  buttons(null, { label: "Cancel", disabled: true, action: null });
  show("progress");
}

function renderSteps() {
  $("steps").innerHTML = "";
  for (const s of steps) {
    const li = document.createElement("li");
    li.className = s.status;
    li.innerHTML = `<svg class="${STEP_CLASS[s.status]}" viewBox="0 0 16 16" aria-hidden="true">${ICONS[s.status]}</svg>`;
    li.append(document.createTextNode(s.label));
    $("steps").append(li);
  }
}

function setProgress(percent) {
  $("progress-fill").style.width = `${percent}%`;
  $("progress-fill").parentElement.setAttribute("aria-valuenow", String(Math.round(percent)));
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
    $("progress-fill").parentElement.classList.add("failed");
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
  if (fresh) hero("WinFynd", "Find anything on your PC by typing or speaking.");
  else if (mode === "update") hero("Update WinFynd", `Version ${installedVersion} to ${version}`);
  else hero("Reinstall WinFynd", `Version ${version} is already installed.`);

  $("location").textContent = state.installDir;
  $("location-row").hidden = !fresh;
  $("autostart-row").hidden = !fresh;
  $("shortcut-row").hidden = !fresh;
  $("kept-row").hidden = fresh;
  $("running-row").hidden = fresh || !running;
  $("autostart").checked = state.autostart;

  footer(`Version ${version}`);
  const label = fresh ? "Install" : mode === "update" ? "Update" : "Reinstall";
  buttons({ label, action: install }, { label: fresh ? "Cancel" : "Not now", action: closeWindow });
  show("install");
}

async function chooseFolder() {
  const picked = await invoke("choose_folder", { current: state.installDir });
  if (picked) {
    state.installDir = picked;
    $("location").textContent = picked;
    $("location-label").textContent = "Install to";
  }
}

async function install() {
  const { mode } = state;
  const fresh = mode === "install";
  const wasRunning = state.running;
  hero(fresh ? "Installing WinFynd" : "Updating WinFynd", "This takes less than a minute.");
  startProgress(fresh ? "Installing" : "Updating", [
    { id: "prepare", label: "Unpacking WinFynd", weight: 1 },
    { id: "copy", label: fresh ? "Copying WinFynd to your user folder" : "Closing WinFynd and replacing its files", weight: 8 },
    { id: "register", label: fresh ? "Adding WinFynd to Start and Apps" : "Checking the new version", weight: 1 },
  ]);
  const run = invoke("install", {
    options: { dir: state.installDir, autostart: $("autostart").checked, desktopShortcut: $("shortcut").checked },
  });
  runMockSteps();
  try {
    await run;
  } catch (error) {
    return failed("WinFynd isn't installed yet", error, renderInstall);
  }

  if (fresh) {
    hero("WinFynd is installed", "It lives in the tray, next to the clock.");
    $("open-row").hidden = false;
    $("next-steps").hidden = false;
  } else {
    // Bring it back the way it was: running in the tray if it was running before.
    if (wasRunning) invoke("launch_app", { background: true }).catch(() => {});
    hero("WinFynd is updated", wasRunning ? "It's running again in the tray." : `You're on version ${state.version}.`);
    $("open-row").hidden = wasRunning;
    $("next-steps").hidden = true;
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

function renderUninstall() {
  hero("Uninstall WinFynd?", "WinFynd closes and is removed from this PC.");
  $("data-size").textContent = state.dataBytes
    ? `${formatBytes(state.dataBytes)} in AppData. Leave this off to keep your index if you install WinFynd again.`
    : "Leave this off to keep your settings if you install WinFynd again.";
  footer(`Version ${state.installedVersion}`);
  buttons({ label: "Uninstall", action: uninstall }, { label: "Cancel", action: closeWindow });
  show("uninstall");
}

async function uninstall() {
  const deleteData = $("delete-data").checked;
  hero("Uninstalling WinFynd", "");
  const list = [{ id: "remove", label: "Closing WinFynd and removing it", weight: 4 }];
  if (deleteData) list.push({ id: "data", label: "Deleting your index and settings", weight: 1 });
  startProgress("Uninstalling", list);
  const run = invoke("uninstall", { deleteData });
  runMockSteps();
  try {
    await run;
  } catch (error) {
    return failed("WinFynd wasn't fully uninstalled", error, renderUninstall);
  }
  hero("WinFynd is uninstalled", "");
  message(
    "ok",
    deleteData ? "Your index and settings were deleted too." : "Your index and settings are still in AppData.",
    deleteData ? "" : "Install WinFynd again and it picks up where you left off.",
  );
  buttons({ label: "Close", action: closeWindow }, null);
}

// --- Other states -----------------------------------------------------------

function failed(title, error, retry) {
  clearInterval(creep);
  hero(title, "");
  message("error", String(error), "");
  buttons({ label: "Close", action: closeWindow }, retry ? { label: "Try again", action: retry } : null);
}

function renderNewer() {
  hero("WinFynd is up to date", "");
  message(
    "info",
    `A newer version, ${state.installedVersion}, is already installed.`,
    `This setup has version ${state.version}. To go back to it, uninstall WinFynd first.`,
  );
  footer("");
  buttons(
    { label: "Open WinFynd", action: () => invoke("launch_app", { background: false }).then(closeWindow, (e) => failed("WinFynd didn't open", e, null)) },
    { label: "Close", action: closeWindow },
  );
}

function renderSimple(title, text, detail) {
  hero(title, "");
  message("info", text, detail);
  footer("");
  buttons({ label: "Close", action: closeWindow }, null);
}

// --- Start ------------------------------------------------------------------

function applyAccent() {
  const root = document.documentElement.style;
  if (state.accentLight) root.setProperty("--accent-light", state.accentLight);
  if (state.accentDark) root.setProperty("--accent-dark", state.accentDark);
}

document.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName;
  if (e.key === "Enter" && tag !== "BUTTON" && !$("primary").hidden && !$("primary").disabled) $("primary").click();
  if (e.key === "Escape" && !$("secondary").hidden && $("secondary").textContent !== "Try again") $("secondary").click();
});

async function start() {
  state = await invoke("get_state");
  applyAccent();
  onStep(updateStep);
  $("change").onclick = chooseFolder;

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
