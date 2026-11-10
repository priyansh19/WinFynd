// Set the WinFynd version everywhere the app and the release workflow read it.
//
//   npm run bump -- 0.2.0
//   npm run bump -- 0.2.0 --dry-run
//
// The release workflow (`.github/workflows/release.yml`) reads the version from
// `src-tauri/tauri.conf.json` and the notes from `docs/releases/<version>.md`.
// There is no separate version-check workflow. This script keeps the other
// package versions on that same number so the installer name, Cargo packages
// and npm package do not drift:
//
//   package.json                         top-level "version"
//   package-lock.json                    root version and packages[""].version
//   src-tauri/Cargo.toml                 [package] version
//   src-tauri/Cargo.lock                 the winfynd package entry
//   src-tauri/tauri.conf.json            top-level "version" (release workflow)
//   setup/Cargo.toml                     [package] version, when the file exists
//   setup/Cargo.lock                     the winfynd-setup package entry
//   setup/tauri.conf.json                top-level "version", when the file exists
//
// website/ and README.md are not version sources. They mention older releases
// on purpose, and this script does not edit them.
//
// Refuses a value that is not MAJOR.MINOR.PATCH (optional prerelease or build
// metadata) and refuses a version that is not strictly higher than the current
// one. Build metadata does not affect precedence. `--dry-run` prints the line
// diff and writes nothing.

import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export class BumpError extends Error {
  constructor(message) {
    super(message);
    this.name = "BumpError";
  }
}

/** @returns {{ major: number, minor: number, patch: number, pre: string[] | null } | null} */
export function parseSemver(input) {
  if (typeof input !== "string") return null;
  const match = SEMVER.exec(input);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split(".") : null,
  };
}

function compareIdent(a, b) {
  const aNum = /^[0-9]+$/.test(a);
  const bNum = /^[0-9]+$/.test(b);
  if (aNum && bNum) {
    const an = BigInt(a);
    const bn = BigInt(b);
    if (an < bn) return -1;
    if (an > bn) return 1;
    return 0;
  }
  if (aNum !== bNum) return aNum ? -1 : 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Negative when a < b, zero when equal (build metadata ignored), positive when a > b. */
export function compareSemver(a, b) {
  const left = typeof a === "string" ? parseSemver(a) : a;
  const right = typeof b === "string" ? parseSemver(b) : b;
  if (!left || !right) throw new BumpError("compareSemver requires a semver version.");
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  if (!left.pre && !right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  const length = Math.max(left.pre.length, right.pre.length);
  for (let i = 0; i < length; i++) {
    if (i >= left.pre.length) return -1;
    if (i >= right.pre.length) return 1;
    const diff = compareIdent(left.pre[i], right.pre[i]);
    if (diff) return diff;
  }
  return 0;
}

function escapeReg(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readText(root, rel) {
  return readFileSync(join(root, rel), "utf8");
}

function packageTable(text, rel) {
  const start = text.search(/^\[package\][^\S\n]*$/m);
  if (start < 0) throw new BumpError(`${rel} has no [package] table.`);
  const rest = text.slice(start);
  const firstNewline = rest.indexOf("\n");
  if (firstNewline < 0) throw new BumpError(`${rel} [package] table is empty.`);
  const nextHeader = rest.slice(firstNewline + 1).search(/^\[/m);
  const end = nextHeader < 0 ? text.length : start + firstNewline + 1 + nextHeader;
  return { section: text.slice(start, end), start, end };
}

function fieldIn(section, field, rel) {
  const match = new RegExp(`^${field}\\s*=\\s*"([^"]*)"`, "m").exec(section);
  if (!match) throw new BumpError(`${rel} [package] has no ${field}.`);
  return match[1];
}

function replaceJsonVersions(text, oldVersion, newVersion, times, rel) {
  const re = new RegExp(`("version"\\s*:\\s*")${escapeReg(oldVersion)}(")`, "g");
  let found = 0;
  const out = text.replace(re, (full, open, close) => {
    if (found >= times) return full;
    found += 1;
    return `${open}${newVersion}${close}`;
  });
  if (found !== times) {
    throw new BumpError(`${rel}: expected ${times} version field(s) of ${oldVersion}, found ${found}.`);
  }
  return out;
}

function jsonVersion(text, rel) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new BumpError(`${rel} is not valid JSON (${error.message}).`);
  }
  if (typeof data.version !== "string") throw new BumpError(`${rel} has no top-level version.`);
  return data.version;
}

function bumpCargoToml(text, oldVersion, newVersion, rel) {
  const table = packageTable(text, rel);
  const current = fieldIn(table.section, "version", rel);
  if (current !== oldVersion) throw new BumpError(`${rel} version is ${current}, expected ${oldVersion}.`);
  const section = table.section.replace(new RegExp(`^(version\\s*=\\s*")${escapeReg(oldVersion)}(")`, "m"), `$1${newVersion}$2`);
  return text.slice(0, table.start) + section + text.slice(table.end);
}

function bumpCargoLock(text, packageName, oldVersion, newVersion, rel) {
  const re = new RegExp(
    `(^\\[\\[package\\]\\]\\r?\\nname = "${escapeReg(packageName)}"\\r?\\nversion = ")${escapeReg(oldVersion)}(")`,
    "m",
  );
  const matches = text.match(new RegExp(re.source, "gm"));
  if (!matches || matches.length !== 1) {
    throw new BumpError(
      `${rel}: expected one ${packageName} package at ${oldVersion}, found ${matches ? matches.length : 0}.`,
    );
  }
  return text.replace(re, `$1${newVersion}$2`);
}

function lockPackageVersion(text, packageName, rel) {
  const re = new RegExp(`^\\[\\[package\\]\\]\\r?\\nname = "${escapeReg(packageName)}"\\r?\\nversion = "([^"]+)"`, "m");
  const match = re.exec(text);
  if (!match) throw new BumpError(`${rel} has no ${packageName} package.`);
  return match[1];
}

function bumpPackageLock(text, oldVersion, newVersion) {
  const marker = text.indexOf('"node_modules/');
  if (marker < 0) throw new BumpError("package-lock.json has no node_modules entries to bound the root version.");
  const head = replaceJsonVersions(text.slice(0, marker), oldVersion, newVersion, 2, "package-lock.json");
  const out = head + text.slice(marker);
  const data = JSON.parse(out);
  if (data.version !== newVersion || data.packages?.[""]?.version !== newVersion) {
    throw new BumpError("package-lock.json root version did not update.");
  }
  return out;
}

function sourceList(root) {
  const required = [
    { rel: "package.json", kind: "package-json" },
    { rel: "package-lock.json", kind: "package-lock" },
    { rel: "src-tauri/Cargo.toml", kind: "cargo-toml" },
    { rel: "src-tauri/Cargo.lock", kind: "cargo-lock" },
    { rel: "src-tauri/tauri.conf.json", kind: "json" },
  ];
  const optional = [
    { rel: "setup/Cargo.toml", kind: "cargo-toml" },
    { rel: "setup/Cargo.lock", kind: "cargo-lock" },
    { rel: "setup/tauri.conf.json", kind: "json" },
  ];
  const present = [...required];
  for (const source of optional) {
    if (existsSync(join(root, source.rel))) present.push(source);
  }
  for (const source of required) {
    if (!existsSync(join(root, source.rel))) throw new BumpError(`Missing ${source.rel}.`);
  }
  return present;
}

function loadSource(root, source) {
  const text = readText(root, source.rel);
  if (source.kind === "package-json" || source.kind === "json") {
    const version = jsonVersion(text, source.rel);
    return {
      ...source,
      version,
      apply: (next) => {
        const out = replaceJsonVersions(text, version, next, 1, source.rel);
        if (jsonVersion(out, source.rel) !== next) throw new BumpError(`${source.rel} version did not update.`);
        return out;
      },
    };
  }
  if (source.kind === "package-lock") {
    const data = JSON.parse(text);
    const rootVersion = data.version;
    const pkgVersion = data.packages?.[""]?.version;
    if (typeof rootVersion !== "string" || typeof pkgVersion !== "string") {
      throw new BumpError("package-lock.json is missing the root version.");
    }
    if (rootVersion !== pkgVersion) {
      throw new BumpError(
        `package-lock.json versions disagree: root ${rootVersion}, packages[""] ${pkgVersion}.`,
      );
    }
    return {
      ...source,
      version: rootVersion,
      apply: (next) => bumpPackageLock(text, rootVersion, next),
    };
  }
  if (source.kind === "cargo-toml") {
    const table = packageTable(text, source.rel);
    const version = fieldIn(table.section, "version", source.rel);
    const packageName = fieldIn(table.section, "name", source.rel);
    return {
      ...source,
      version,
      packageName,
      apply: (next) => bumpCargoToml(text, version, next, source.rel),
    };
  }
  const tomlRel = source.rel.replace(/Cargo\.lock$/, "Cargo.toml");
  const packageName = fieldIn(packageTable(readText(root, tomlRel), tomlRel).section, "name", tomlRel);
  const version = lockPackageVersion(text, packageName, source.rel);
  return {
    ...source,
    version,
    packageName,
    apply: (next) => bumpCargoLock(text, packageName, version, next, source.rel),
  };
}

/**
 * @param {{ root: string, version: string, dryRun?: boolean }} options
 * @returns {{ current: string, next: string, dryRun: boolean, edits: { rel: string, before: string, after: string }[] }}
 */
export function bump({ root, version, dryRun = false }) {
  const next = typeof version === "string" ? version.trim() : "";
  if (!parseSemver(next)) {
    throw new BumpError(
      `Not a semver version: ${next || "(missing)"}. Use MAJOR.MINOR.PATCH, with an optional prerelease such as 0.2.0-rc.1.`,
    );
  }
  const sources = sourceList(root).map((source) => loadSource(root, source));
  const versions = [...new Set(sources.map((source) => source.version))];
  if (versions.length !== 1) {
    const detail = sources.map((source) => `  ${source.rel}: ${source.version}`).join("\n");
    throw new BumpError(`Version fields disagree, so nothing was written:\n${detail}`);
  }
  const current = versions[0];
  if (!parseSemver(current)) throw new BumpError(`Current version is not semver: ${current}`);
  const order = compareSemver(next, current);
  if (order < 0) throw new BumpError(`Refusing ${next}: it is lower than the current version ${current}.`);
  if (order === 0) throw new BumpError(`Refusing ${next}: it is not higher than the current version ${current}.`);

  const edits = sources.map((source) => ({
    rel: source.rel,
    before: readText(root, source.rel),
    after: source.apply(next),
  }));
  if (!dryRun) {
    for (const edit of edits) {
      if (edit.before !== edit.after) writeFileSync(join(root, edit.rel), edit.after);
    }
  }
  return { current, next, dryRun, edits };
}

export function summarize(result) {
  const lines = [
    `${result.dryRun ? "Dry run. " : ""}Version ${result.current} -> ${result.next}`,
  ];
  let files = 0;
  for (const edit of result.edits) {
    if (edit.before === edit.after) continue;
    files += 1;
    lines.push("", edit.rel);
    const before = edit.before.split("\n");
    const after = edit.after.split("\n");
    const length = Math.max(before.length, after.length);
    for (let i = 0; i < length; i++) {
      if (before[i] === after[i]) continue;
      if (before[i] !== undefined) lines.push(`- ${before[i]}`);
      if (after[i] !== undefined) lines.push(`+ ${after[i]}`);
    }
  }
  lines.push("", `${files} file${files === 1 ? "" : "s"} ${result.dryRun ? "would change" : "changed"}.`);
  return lines.join("\n");
}

function repoRoot() {
  return fileURLToPath(new URL("..", import.meta.url));
}

function printUsage() {
  return [
    "Usage: npm run bump -- <version> [--dry-run]",
    "       node scripts/bump-version.mjs <version> [--dry-run]",
    "",
    "Refuses a non-semver version and a version that is not higher than the current one.",
    "Example: npm run bump -- 0.2.0 --dry-run",
  ].join("\n");
}

export function parseArgs(argv) {
  const args = { version: "", dryRun: false, root: "", help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run" || arg === "-n") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--root") {
      args.root = argv[++i] ?? "";
      if (!args.root) throw new BumpError("--root needs a directory.");
    } else if (arg.startsWith("-")) {
      throw new BumpError(`Unknown option: ${arg}\n\n${printUsage()}`);
    } else if (!args.version) args.version = arg;
    else throw new BumpError(`Unexpected extra argument: ${arg}\n\n${printUsage()}`);
  }
  return args;
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.version) {
    console.log(printUsage());
    if (!args.version) process.exitCode = 1;
    return;
  }
  const result = bump({ root: args.root || repoRoot(), version: args.version, dryRun: args.dryRun });
  console.log(summarize(result));
}

if (invokedDirectly()) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
