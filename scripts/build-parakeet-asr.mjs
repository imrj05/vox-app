import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcTauri = path.join(root, "src-tauri");
const rebuild = process.argv.includes("--rebuild");
const targetTriple = execSync("rustc --print host-tuple", { encoding: "utf8" }).trim();
const ext = process.platform === "win32" ? ".exe" : "";
const destDir = path.join(srcTauri, "bin");
const dest = path.join(destDir, `transcribe-cli-${targetTriple}${ext}`);

// Rebuild when the staged binary is older than the local --serve patch: the
// patch is the only Vox-owned input, and skipping on existence would stage a
// runtime without it. Otherwise reuse the cached build.
const patchPath = path.join(srcTauri, "patches", "transcribe-cli-serve.patch");
const staged = fs.existsSync(dest) ? fs.statSync(dest) : null;
const patchMtime = fs.existsSync(patchPath) ? fs.statSync(patchPath).mtimeMs : 0;
// A 0-byte staged file is not a build: treat it as missing, otherwise an empty
// sidecar newer than the patch is "up to date" and the app spawns a process
// that dies instantly ("Parakeet runtime exited unexpectedly").
if (!rebuild && staged && staged.size > 0 && staged.mtimeMs > patchMtime) {
  console.log(`transcribe-cli up to date at ${dest}`);
  process.exit(0);
}

// Pin the upstream tree the --serve patch is written against. Tracking HEAD
// would silently stage a runtime whose `--serve` flag no longer exists: the
// app then spawns a process that dies on "unknown option '--serve'" and
// surfaces it as "Parakeet runtime exited unexpectedly". Bump this together
// with the patch, and rebuild with --rebuild.
const upstreamRef = "v0.4.1";
const patch = path.join(srcTauri, "patches", "transcribe-cli-serve.patch");

// Cache the transcribe.cpp checkout so repeated runs are fast.
const repoDir = path.join(os.tmpdir(), "vox-transcribe-cpp");
const buildDir = path.join(repoDir, "build");

if (!fs.existsSync(path.join(repoDir, "CMakeLists.txt"))) {
  fs.mkdirSync(repoDir, { recursive: true });
  console.log(`Cloning transcribe.cpp (${upstreamRef})…`);
  execSync(
    `git clone --depth 1 --branch ${upstreamRef} https://github.com/handy-computer/transcribe.cpp.git .`,
    { cwd: repoDir, stdio: "inherit" }
  );
}

// Reset the cache to the pinned tree so a checkout left dirty (or at another
// revision) by an earlier run cannot make the patch silently miss. Untracked
// build output survives, so incremental builds stay incremental.
const pinned = execSync(`git rev-parse ${upstreamRef}^{commit}`, {
  cwd: repoDir,
  encoding: "utf8",
}).trim();
const head = execSync("git rev-parse HEAD", { cwd: repoDir, encoding: "utf8" }).trim();
if (head !== pinned) {
  execSync(`git fetch --depth 1 origin ${upstreamRef}`, { cwd: repoDir, stdio: "inherit" });
  execSync(`git checkout --force --detach ${pinned}`, { cwd: repoDir, stdio: "inherit" });
}
if (execSync("git status --porcelain", { cwd: repoDir, encoding: "utf8" }).trim() !== "") {
  execSync("git checkout --force .", { cwd: repoDir, stdio: "inherit" });
}

// The patch is required, not best-effort: a runtime without --serve cannot
// serve Vox at all, so failing here beats staging a half-working sidecar.
try {
  execSync(`git apply --check "${patch}"`, { cwd: repoDir, stdio: "pipe" });
  execSync(`git apply "${patch}"`, { cwd: repoDir });
  console.log("Applied transcribe.cpp --serve patch");
} catch (error) {
  console.error(
    `transcribe-cli-serve.patch does not apply to ${upstreamRef}.\n` +
      "Rebase src-tauri/patches/transcribe-cli-serve.patch onto the new " +
      "upstream tree and bump upstreamRef, or the app will fail to run Parakeet."
  );
  process.exit(1);
}

console.log("Configuring transcribe.cpp build…");
execSync(`cmake -B ${buildDir} -DCMAKE_BUILD_TYPE=Release`, {
  cwd: repoDir,
  stdio: "inherit",
});

console.log("Building transcribe-cli…");
execSync(`cmake --build ${buildDir} --config Release --target transcribe-cli -j`, {
  cwd: repoDir,
  stdio: "inherit",
});

// Locate the built binary. CMake's runtime output directory is `bin/`, and on
// Windows (multi-config MSBuild) the per-config subfolder is `bin/Release/`.
const candidates =
  process.platform === "win32"
    ? [
        path.join(buildDir, "bin", "Release", `transcribe-cli${ext}`),
        path.join(buildDir, "Release", `transcribe-cli${ext}`),
      ]
    : [path.join(buildDir, "bin", `transcribe-cli${ext}`)];
const source = candidates.find((candidate) => fs.existsSync(candidate));
if (!source) {
  console.error(
    `transcribe-cli binary not found (tried: ${candidates.join(", ")})`
  );
  process.exit(1);
}

// Verify the patch actually made it into the binary before staging it, so a
// runtime without --serve can never reach the app or a release bundle.
const help = execSync(`"${source}" --help 2>&1 || true`, { encoding: "utf8" });
if (!help.includes("--serve")) {
  console.error(
    `Built ${source} does not support --serve; refusing to stage it.`
  );
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(source, dest);
if (process.platform !== "win32") {
  fs.chmodSync(dest, 0o755);
}

console.log(`Staged Parakeet runtime at ${dest}`);
