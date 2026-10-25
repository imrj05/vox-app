import { mkdir, readFile, readdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { writeUpdaterManifest } from "./generate-updater-manifest.mjs"

// Collects the per-architecture manifests produced by separate build jobs (one
// `latest.json` each, uploaded as their own CI artifact) into the single
// manifest the updater consumes, which needs every platform entry at once.
async function findManifests(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true })
  const found = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = resolve(dirPath, entry.name)
      if (entry.isDirectory()) {
        return findManifests(entryPath)
      }

      return entry.name === "latest.json" ? [entryPath] : []
    })
  )

  return found.flat()
}

async function main() {
  const sourceDir = resolve(process.cwd(), process.argv[2] ?? "artifacts")
  const manifestPaths = await findManifests(sourceDir)
  if (manifestPaths.length === 0) {
    throw new Error(`No latest.json manifests found under ${sourceDir}.`)
  }

  const manifests = await Promise.all(
    manifestPaths.map(async (manifestPath) => ({
      manifestPath,
      manifest: JSON.parse(await readFile(manifestPath, "utf8")),
    }))
  )

  const versions = [...new Set(manifests.map(({ manifest }) => manifest.version))]
  if (versions.length !== 1) {
    throw new Error(`Updater manifests disagree on the version: ${versions.join(", ")}`)
  }

  const platforms = {}
  const sources = {}
  for (const { manifestPath, manifest } of manifests) {
    for (const [platform, entry] of Object.entries(manifest.platforms ?? {})) {
      if (platforms[platform]) {
        throw new Error(`${platform} is produced by both ${sources[platform]} and ${manifestPath}.`)
      }

      platforms[platform] = entry
      sources[platform] = manifestPath
    }
  }

  const withNotes = manifests.find(({ manifest }) => manifest.notes?.trim())
  const outPath = resolve(process.cwd(), process.env.RELEASE_MANIFEST_PATH ?? "release/latest.json")
  await mkdir(dirname(outPath), { recursive: true })
  await writeUpdaterManifest({
    version: versions[0],
    notes: withNotes?.manifest.notes ?? "",
    pubDate: manifests[0].manifest.pub_date,
    platforms,
    outPath,
  })

  console.log(`Merged ${manifestPaths.length} manifest(s) into ${outPath}`)
  for (const [platform, entry] of Object.entries(platforms)) {
    console.log(`- ${platform}: ${entry.url}`)
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectRun) {
  await main()
}
