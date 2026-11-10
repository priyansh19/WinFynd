import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { bump, compareSemver, parseSemver, summarize } from "./bump-version.mjs";

const script = fileURLToPath(new URL("./bump-version.mjs", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function fixture(version = "0.1.1") {
  const root = mkdtempSync(join(tmpdir(), "winfynd-bump-"));
  writeFileSync(
    join(root, "package.json"),
    `{\n  "name": "winfynd",\n  "version": "${version}",\n  "dependencies": {\n    "left-alone": "0.1.1"\n  }\n}\n`,
  );
  writeFileSync(
    join(root, "package-lock.json"),
    `{
  "name": "winfynd",
  "version": "${version}",
  "lockfileVersion": 3,
  "packages": {
    "": {
      "name": "winfynd",
      "version": "${version}"
    },
    "node_modules/left-alone": {
      "version": "${version}"
    }
  }
}
`,
  );
  const tauri = join(root, "src-tauri");
  const setup = join(root, "setup");
  mkdirSync(tauri, { recursive: true });
  mkdirSync(setup, { recursive: true });
  writeFileSync(
    join(tauri, "Cargo.toml"),
    `[package]\nname = "winfynd"\nversion = "${version}"\ndescription = "fixture"\nedition = "2021"\n\n[dependencies]\nserde = { version = "1", features = ["derive"] }\n`,
  );
  writeFileSync(
    join(tauri, "Cargo.lock"),
    `[[package]]\nname = "decoy"\nversion = "${version}"\n\n[[package]]\nname = "winfynd"\nversion = "${version}"\ndependencies = [\n "serde 0.1.1",\n]\n`,
  );
  writeFileSync(
    join(tauri, "tauri.conf.json"),
    `{\n  "productName": "WinFynd",\n  "version": "${version}",\n  "identifier": "app.winfynd.desktop"\n}\n`,
  );
  writeFileSync(
    join(setup, "Cargo.toml"),
    `[package]\nname = "winfynd-setup"\nversion = "${version}"\nedition = "2021"\n\n[dependencies]\ntauri = { version = "2", features = [] }\n`,
  );
  writeFileSync(
    join(setup, "Cargo.lock"),
    `[[package]]\nname = "something"\nversion = "0.1.1"\n\n[[package]]\nname = "winfynd-setup"\nversion = "${version}"\n`,
  );
  writeFileSync(
    join(setup, "tauri.conf.json"),
    `{\n  "productName": "WinFynd Setup",\n  "version": "${version}",\n  "identifier": "app.winfynd.setup"\n}\n`,
  );
  return root;
}

test("parseSemver accepts release and prerelease, rejects a v prefix", () => {
  assert.deepEqual(parseSemver("0.2.0"), { major: 0, minor: 2, patch: 0, pre: null });
  assert.deepEqual(parseSemver("0.2.0-rc.1"), { major: 0, minor: 2, patch: 0, pre: ["rc", "1"] });
  assert.equal(parseSemver("v0.2.0"), null);
  assert.equal(parseSemver("0.2"), null);
  assert.equal(parseSemver("0.2.0.1"), null);
});

test("compareSemver orders prerelease below the final release", () => {
  assert.ok(compareSemver("0.1.1", "0.2.0") < 0);
  assert.ok(compareSemver("0.2.0-rc.1", "0.1.1") > 0);
  assert.ok(compareSemver("0.2.0-rc.1", "0.2.0") < 0);
  assert.ok(compareSemver("0.2.0-rc.2", "0.2.0-rc.10") < 0);
  assert.equal(compareSemver("0.2.0+build.1", "0.2.0"), 0);
  assert.ok(compareSemver("1.0.0-alpha", "1.0.0-alpha.1") < 0);
});

test("dry-run updates every version field in the summary and writes nothing", () => {
  const root = fixture();
  const before = readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8");
  const result = bump({ root, version: "0.2.0", dryRun: true });
  assert.equal(result.current, "0.1.1");
  assert.equal(result.next, "0.2.0");
  assert.equal(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"), before);
  const summary = summarize(result);
  for (const rel of [
    "package.json",
    "package-lock.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "src-tauri/tauri.conf.json",
    "setup/Cargo.toml",
    "setup/Cargo.lock",
    "setup/tauri.conf.json",
  ]) {
    assert.match(summary, new RegExp(rel.replace("/", "\\/")));
  }
  assert.match(summary, /Dry run/);
  assert.match(summary, /8 files would change/);
  assert.doesNotMatch(summary, /decoy/);
  assert.doesNotMatch(summary, /left-alone/);
});

test("a real bump on a fixture keeps decoy versions and dependency versions", () => {
  const root = fixture();
  bump({ root, version: "0.2.0-rc.1" });
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.version, "0.2.0-rc.1");
  assert.equal(pkg.dependencies["left-alone"], "0.1.1");
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  assert.equal(lock.version, "0.2.0-rc.1");
  assert.equal(lock.packages[""].version, "0.2.0-rc.1");
  assert.equal(lock.packages["node_modules/left-alone"].version, "0.1.1");
  const cargoLock = readFileSync(join(root, "src-tauri", "Cargo.lock"), "utf8");
  assert.match(cargoLock, /name = "decoy"\nversion = "0.1.1"/);
  assert.match(cargoLock, /name = "winfynd"\nversion = "0.2.0-rc.1"/);
  assert.match(cargoLock, /"serde 0.1.1"/);
  assert.match(readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8"), /version = "0.2.0-rc.1"/);
  assert.match(readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8"), /version = "1"/);
  assert.match(readFileSync(join(root, "setup", "Cargo.lock"), "utf8"), /name = "something"\nversion = "0.1.1"/);
  assert.match(readFileSync(join(root, "setup", "Cargo.lock"), "utf8"), /name = "winfynd-setup"\nversion = "0.2.0-rc.1"/);
  assert.equal(JSON.parse(readFileSync(join(root, "setup", "tauri.conf.json"), "utf8")).version, "0.2.0-rc.1");
});

test("refuses a non-semver, a lower version, and the same version without writing", () => {
  const root = fixture();
  const before = readFileSync(join(root, "package.json"), "utf8");
  assert.throws(() => bump({ root, version: "v0.2.0" }), /Not a semver version/);
  assert.throws(() => bump({ root, version: "0.1.0" }), /lower than the current version 0\.1\.1/);
  assert.throws(() => bump({ root, version: "0.1.1" }), /not higher than the current version 0\.1\.1/);
  assert.throws(() => bump({ root, version: "0.1.1+build.2" }), /not higher than the current version 0\.1\.1/);
  bump({ root, version: "0.2.0" });
  assert.throws(() => bump({ root, version: "0.2.0-rc.1" }), /lower than the current version 0\.2\.0/);
  assert.equal(readFileSync(join(root, "package.json"), "utf8").includes('"version": "0.2.0"'), true);
  assert.notEqual(readFileSync(join(root, "package.json"), "utf8"), before);
});

test("refuses to write when the version fields already disagree", () => {
  const root = fixture();
  const tauri = join(root, "src-tauri", "tauri.conf.json");
  writeFileSync(tauri, readFileSync(tauri, "utf8").replace("0.1.1", "0.9.0"));
  const before = readFileSync(join(root, "package.json"), "utf8");
  assert.throws(() => bump({ root, version: "1.0.0" }), /Version fields disagree/);
  assert.equal(readFileSync(join(root, "package.json"), "utf8"), before);
});

test("setup files are optional", () => {
  const root = fixture();
  rmSync(join(root, "setup"), { recursive: true, force: true });
  const result = bump({ root, version: "0.2.0", dryRun: true });
  assert.equal(result.edits.length, 5);
  assert.ok(result.edits.every((edit) => !edit.rel.startsWith("setup/")));
});

test("this repo's version fields agree and are semver", () => {
  const result = bump({ root: repoRoot, version: "99.0.0", dryRun: true });
  assert.equal(parseSemver(result.current)?.major >= 0, true);
  assert.ok(result.edits.length >= 5);
  const tauri = result.edits.find((edit) => edit.rel === "src-tauri/tauri.conf.json");
  assert.equal(JSON.parse(tauri.before).version, result.current);
  assert.equal(JSON.parse(tauri.after).version, "99.0.0");
  assert.equal(JSON.parse(readFileSync(join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8")).version, result.current);
});

test("the CLI refuses a lower version and a dry-run does not print a write", () => {
  const root = fixture();
  const lower = spawnSync(process.execPath, [script, "0.0.1", "--root", root], { encoding: "utf8" });
  assert.notEqual(lower.status, 0);
  assert.match(lower.stderr, /lower than the current version/);
  const dry = spawnSync(process.execPath, [script, "--dry-run", "0.2.0", "--root", root], { encoding: "utf8" });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Dry run/);
  assert.match(dry.stdout, /src-tauri\/tauri.conf.json/);
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version, "0.1.1");
  const missing = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stdout, /Usage:/);
});
