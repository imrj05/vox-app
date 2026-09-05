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

if (!rebuild && fs.existsSync(dest)) {
  console.log(`transcribe-cli already staged at ${dest}`);
  process.exit(0);
}

// Cache the transcribe.cpp checkout so repeated runs are fast.
const repoDir = path.join(os.tmpdir(), "vox-transcribe-cpp");
const buildDir = path.join(repoDir, "build");

if (!fs.existsSync(path.join(repoDir, "CMakeLists.txt"))) {
  fs.mkdirSync(repoDir, { recursive: true });
  console.log("Cloning transcribe.cpp (shallow)…");
  execSync(
    "git clone --depth 1 https://github.com/handy-computer/transcribe.cpp.git .",
    { cwd: repoDir, stdio: "inherit" }
  );
}

// Apply the local --serve patch (persistent warm-model mode used by the Vox
// app). Idempotent: `git apply --check` fails when it is already applied.
if (fs.existsSync(path.join(repoDir, ".git"))) {
  const patch = path.join(root, "src-tauri", "patches", "transcribe-cli-serve.patch");
  try {
    execSync(`git apply --check "${patch}"`, { cwd: repoDir, stdio: "pipe" });
    execSync(`git apply "${patch}"`, { cwd: repoDir });
    console.log("Applied transcribe.cpp --serve patch");
  } catch {
    console.log("--serve patch already applied (or not applicable); continuing");
  }
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

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(source, dest);
if (process.platform !== "win32") {
  fs.chmodSync(dest, 0o755);
}

console.log(`Staged Parakeet runtime at ${dest}`);
