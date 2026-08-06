import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcTauri = path.join(root, "src-tauri");
const release = process.argv.includes("--release");
const profileDir = release ? "release" : "debug";
const targetDir = path.join(srcTauri, "target");
const cargoArgs = release
  ? ["build", "--release", "-p", "vox-text-enhance", "--target-dir", targetDir]
  : ["build", "-p", "vox-text-enhance", "--target-dir", targetDir];

execSync(`cargo ${cargoArgs.join(" ")}`, {
  cwd: srcTauri,
  stdio: "inherit",
});

const targetTriple = execSync("rustc --print host-tuple", {
  encoding: "utf8",
}).trim();
const ext = process.platform === "win32" ? ".exe" : "";
const source = path.join(targetDir, profileDir, `vox-text-enhance${ext}`);
const destDir = path.join(srcTauri, "bin");
const dest = path.join(destDir, `vox-text-enhance-${targetTriple}${ext}`);

if (!fs.existsSync(source)) {
  console.error(`Sidecar binary not found at ${source}`);
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(source, dest);
if (process.platform !== "win32") {
  fs.chmodSync(dest, 0o755);
}

console.log(`Staged text enhancement sidecar at ${dest}`);
