import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function fail(message) {
  console.error(`Version bump failed: ${message}`);
  process.exit(1);
}

function compare(a, b) {
  const [aMajor, aMinor, aPatch] = a.split(".").map(Number);
  const [bMajor, bMinor, bPatch] = b.split(".").map(Number);
  return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch;
}

function replaceVersion(path, pattern, next) {
  const contents = readFileSync(path, "utf8");
  if (!pattern.test(contents)) {
    fail(`could not find the version field in ${path}.`);
  }
  writeFileSync(path, contents.replace(pattern, `$1${next}$2`), "utf8");
}

const next = process.argv[2];
if (!next || !SEMVER.test(next)) {
  fail(`usage: pnpm version:bump <x.y.z> (got: ${next ?? "nothing"}).`);
}

const current = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
if (compare(next, current) <= 0) {
  fail(`${next} must be greater than the current version ${current}.`);
}

replaceVersion("package.json", /^(\s*"version":\s*")[^"]+(")/m, next);
replaceVersion("src-tauri/tauri.conf.json", /^(\s*"version":\s*")[^"]+(")/m, next);
replaceVersion("src-tauri/Cargo.toml", /^(version = ")[^"]+(")/m, next);
replaceVersion("src-tauri/Cargo.lock", /(\[\[package\]\]\nname = "vox"\nversion = ")[^"]+(")/, next);

console.log(`Version bumped ${current} -> ${next}`);
execFileSync(process.execPath, ["scripts/check-version-consistency.mjs"], { stdio: "inherit" });
console.log(`Next: git commit -am "chore: release v${next}" && git push origin main`);
