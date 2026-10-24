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

if (!rebuild && fs.existsSync(dest)) {
  console.log(`apple-speech already staged at ${dest}`);
  process.exit(0);
}

// Incremental rebuilds: swiftc is fast enough that always rebuilding --dev
// would still slow the dev loop; rely on mtime comparison.
if (!rebuild && fs.existsSync(dest)) {
  process.exit(0);
}

console.log("Compiling apple-speech sidecar…");
execSync(`swiftc -O "${source}" -o "${dest}"`, { stdio: "inherit" });
fs.chmodSync(dest, 0o755);
console.log(`Staged Apple Speech runtime at ${dest}`);