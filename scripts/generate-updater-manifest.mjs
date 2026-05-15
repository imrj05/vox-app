import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required value for ${label}.`)
  }

  return value.trim()
}

function normalizePlatforms(platforms) {
  if (!platforms || typeof platforms !== "object" || Array.isArray(platforms)) {
    throw new Error("Expected platforms to be an object keyed by Tauri platform name.")
  }

  return Object.fromEntries(
    Object.entries(platforms).map(([platform, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Expected platform entry for ${platform} to be an object.`)
      }

      return [
        assertNonEmptyString(platform, "platform"),
        {
          signature: assertNonEmptyString(value.signature, `${platform} signature`),
          url: assertNonEmptyString(value.url, `${platform} url`),
        },
      ]
    })
  )
}

export async function writeUpdaterManifest({
  version,
  notes = "",
  pubDate = new Date().toISOString(),
  platforms,
  outPath = resolve(process.cwd(), "release", "latest.json"),
}) {
  const manifest = {
    version: assertNonEmptyString(version, "version"),
    notes,
    pub_date: assertNonEmptyString(pubDate, "pubDate"),
    platforms: normalizePlatforms(platforms),
  }

  const resolvedOutPath = resolve(process.cwd(), outPath)
  await writeFile(resolvedOutPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  return resolvedOutPath
}

function readPlatformsFromEnv() {
  const platformsJson = process.env.RELEASE_PLATFORMS_JSON
  if (platformsJson) {
    return JSON.parse(platformsJson)
  }

  return {
    [process.env.RELEASE_PLATFORM ?? "darwin-aarch64"]: {
      signature: process.env.RELEASE_SIGNATURE,
      url: process.env.RELEASE_URL,
    },
  }
}

async function main() {
  const version = process.env.RELEASE_VERSION
  if (!version) {
    throw new Error("Missing required env var RELEASE_VERSION.")
  }

  const outPath = await writeUpdaterManifest({
    version,
    notes: process.env.RELEASE_NOTES ?? "",
    pubDate: process.env.RELEASE_DATE ?? new Date().toISOString(),
    platforms: readPlatformsFromEnv(),
    outPath: process.env.RELEASE_MANIFEST_PATH,
  })

  console.log(`Updater manifest written to ${outPath}`)
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectRun) {
  await main()
}
