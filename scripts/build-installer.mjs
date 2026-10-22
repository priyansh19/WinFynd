// Builds the WinFynd installer: dist-installer/WinFynd-Setup-<version>.exe.
//
// 1. The setup window without a payload, which ships inside the app as its uninstaller.
// 2. The app and its NSIS installer (`tauri build`), which picks up step 1 through
//    src-tauri/windows/hooks.nsh, and llama.cpp's server from src-tauri/llama
//    (scripts/fetch-llama.mjs) to run the search model.
// 3. The setup window again, with the NSIS installer from step 2 embedded.
//
// Run on Windows: npm run build:installer

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fetchLlama } from "./fetch-llama.mjs";

const root = resolve(import.meta.dirname, "..");
const setupManifest = join(root, "setup", "Cargo.toml");
const setupExe = join(root, "setup", "target", "release", "winfynd-setup.exe");
const { version, productName } = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));

function run(command, env = {}) {
  console.log(`\n> ${command}`);
  execSync(command, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
}

run(`cargo build --release --manifest-path "${setupManifest}"`, { WINFYND_VERSION: version });
mkdirSync(join(root, "src-tauri", "target"), { recursive: true });
copyFileSync(setupExe, join(root, "src-tauri", "target", "uninstall-ui.exe"));

await fetchLlama();
run("npx tauri build");
const payload = join(root, "src-tauri", "target", "release", "bundle", "nsis", `${productName}_${version}_x64-setup.exe`);
if (!existsSync(payload)) throw new Error(`tauri build didn't produce ${payload}`);

run(`cargo build --release --features payload --manifest-path "${setupManifest}"`, {
  WINFYND_PAYLOAD: payload,
  WINFYND_VERSION: version,
});
const out = join(root, "dist-installer", `${productName}-Setup-${version}.exe`);
mkdirSync(join(root, "dist-installer"), { recursive: true });
copyFileSync(setupExe, out);
console.log(`\nInstaller: ${out}`);
