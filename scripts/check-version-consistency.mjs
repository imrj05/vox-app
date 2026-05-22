import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function fail(message) {
  console.error(`Version check failed: ${message}`);
  process.exitCode = 1;
}

function getBranchName() {
  try {
    return execSync("git branch --show-current", { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const packageVersion = readJson("package.json").version;
const tauriVersion = readJson("src-tauri/tauri.conf.json").version;
const cargoToml = readText("src-tauri/Cargo.toml");
const cargoLock = readText("src-tauri/Cargo.lock");
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const lockVersion = cargoLock.match(/\[\[package\]\]\nname = "vox"\nversion = "([^"]+)"/m)?.[1];

if (packageVersion !== tauriVersion) {
  fail(`package.json version (${packageVersion}) must match src-tauri/tauri.conf.json (${tauriVersion}).`);
}

if (cargoVersion !== tauriVersion) {
  fail(`src-tauri/Cargo.toml version (${cargoVersion ?? "missing"}) must match src-tauri/tauri.conf.json (${tauriVersion}).`);
}

if (lockVersion !== tauriVersion) {
  fail(`src-tauri/Cargo.lock vox version (${lockVersion ?? "missing"}) must match src-tauri/tauri.conf.json (${tauriVersion}).`);
}

const branchName = getBranchName();
const releaseBranch = branchName.match(/^(?:version|release)\/(?:v)?(.+)$/)?.[1];
if (releaseBranch && releaseBranch !== tauriVersion) {
  fail(`branch ${branchName} must match src-tauri version v${tauriVersion}.`);
}

if (!process.exitCode) {
  console.log(`Version check passed: ${tauriVersion}`);
}
