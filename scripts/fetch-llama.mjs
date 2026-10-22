// Puts llama.cpp's server (llama-server.exe and its DLLs) in src-tauri/llama, where
// `tauri build` picks it up as a resource. WinFynd runs EmbeddingGemma 2 with it, so
// Ollama isn't needed. The CPU build works on any x64 PC.
//
// Pinned to a release that has the gemma-embedding2 architecture (added 6 October 2026,
// llama.cpp PR #30054). Run on Windows: node scripts/fetch-llama.mjs

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LLAMA_BUILD = "b11454";
const asset = `llama-${LLAMA_BUILD}-bin-win-cpu-x64.zip`;
const url = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}/${asset}`;

const root = resolve(import.meta.dirname, "..");
const out = join(root, "src-tauri", "llama");

export async function fetchLlama() {
  if (existsSync(join(out, "llama-server.exe")) && existsSync(join(out, `${LLAMA_BUILD}.txt`))) {
    console.log(`llama.cpp ${LLAMA_BUILD} is already in ${out}`);
    return;
  }
  console.log(`\n> Downloading ${url}`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Downloading ${asset} failed: ${resp.status} ${resp.statusText}`);
  const work = join(tmpdir(), `winfynd-llama-${LLAMA_BUILD}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const zip = join(work, asset);
  writeFileSync(zip, Buffer.from(await resp.arrayBuffer()));
  // Windows 10 and later ship bsdtar, which reads zip files.
  execSync(`tar -xf "${zip}" -C "${work}"`, { stdio: "inherit" });

  // The zip holds every llama.cpp tool; WinFynd only needs the server and the libraries.
  const found = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "llama-server.exe" || e.name.toLowerCase().endsWith(".dll")) found.push(p);
    }
  };
  walk(work);
  if (!found.some((p) => p.endsWith("llama-server.exe"))) throw new Error(`${asset} has no llama-server.exe`);
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(out)) if (f !== "README.md") rmSync(join(out, f), { force: true });
  for (const p of found) copyFileSync(p, join(out, p.split(/[\\/]/).pop()));
  writeFileSync(join(out, `${LLAMA_BUILD}.txt`), `${url}\n`);
  console.log(`Copied ${found.length} files to ${out}`);
  rmSync(work, { recursive: true, force: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await fetchLlama();
}
