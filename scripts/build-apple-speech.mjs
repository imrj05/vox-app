import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcTauri = path.join(root, "src-tauri");
const source = path.join(srcTauri, "apple-speech", "main.swift");
const rebuild = process.argv.includes("--rebuild");

// Apple Speech is macOS-only.
if (process.platform !== "darwin") {
  console.log("apple-speech: skipped (not macOS)");
  process.exit(0);
}

const targetTriple = execSync("rustc --print host-tuple", { encoding: "utf8" }).trim();
const destDir = path.join(srcTauri, "bin");
fs.mkdirSync(destDir, { recursive: true });
const dest = path.join(destDir, `apple-speech-${targetTriple}`);

// swiftc is fast (a few seconds), so rebuild whenever the source is newer than
// the staged binary. Skipping on mere existence silently shipped a stale engine
// after every edit to main.swift.
const sourceMtime = fs.statSync(source).mtimeMs;
const staged = fs.existsSync(dest) ? fs.statSync(dest) : null;
// A 0-byte staged file means a previous compile failed; rebuild instead of
// reporting an empty engine as up to date.
if (!rebuild && staged && staged.size > 0 && staged.mtimeMs > sourceMtime) {
  console.log(`apple-speech up to date at ${dest}`);
  process.exit(0);
}

console.log("Compiling apple-speech sidecar…");
execSync(`swiftc -O "${source}" -o "${dest}"`, { stdio: "inherit" });
fs.chmodSync(dest, 0o755);
console.log(`Staged Apple Speech runtime at ${dest}`);