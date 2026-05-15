import { access, readFile, readdir, writeFile } from "node:fs/promises"
import { basename, resolve } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { pathToFileURL } from "node:url"
import { writeUpdaterManifest } from "./generate-updater-manifest.mjs"

const execFileAsync = promisify(execFile)

async function readTauriConfig() {
  const configPath = resolve(process.cwd(), "src-tauri", "tauri.conf.json")
  const config = JSON.parse(await readFile(configPath, "utf8"))
  return {
    configPath,
    productName: config.productName,
    version: config.version,
  }
}

async function walkFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = resolve(dirPath, entry.name)
      if (entry.isDirectory()) {
        return walkFiles(entryPath)
      }

      return [entryPath]
    })
  )

  return files.flat()
}

async function resolveArchivePath(productName) {
  const overridePath = process.env.RELEASE_ARCHIVE_PATH
  if (overridePath) {
    const resolvedOverridePath = resolve(process.cwd(), overridePath)
    await access(resolvedOverridePath)
    return resolvedOverridePath
  }

  const bundleDir = resolve(process.cwd(), "src-tauri", "target", "release", "bundle")
  await access(bundleDir)

  const files = await walkFiles(bundleDir)
  const archives = files.filter((filePath) => filePath.endsWith(".tar.gz") && !filePath.endsWith(".sig"))
  const preferredName = `${productName}.app.tar.gz`
  const preferredMatches = archives.filter((filePath) => basename(filePath) === preferredName)
  const appArchives = preferredMatches.length > 0 ? preferredMatches : archives.filter((filePath) => basename(filePath).endsWith(".app.tar.gz"))

  if (appArchives.length === 0) {
    throw new Error(
      "No updater archive found under src-tauri/target/release/bundle. Run `pnpm desktop:build` first or provide RELEASE_ARCHIVE_PATH."
    )
  }

  appArchives.sort((left, right) => right.localeCompare(left))
  return appArchives[0]
}

function resolveSigningEnv() {
  const rawPrivateKey = process.env.TAURI_SIGNING_PRIVATE_KEY?.trim()
  const privateKeyPath = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH?.trim()
  const password = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD

  if (rawPrivateKey) {
    return {
      mode: "env",
      env: {
        TAURI_SIGNING_PRIVATE_KEY: rawPrivateKey,
        ...(password ? { TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password } : {}),
      },
      args: [],
      sourceLabel: "TAURI_SIGNING_PRIVATE_KEY",
    }
  }

  if (privateKeyPath) {
    return {
      mode: "path",
      env: password ? { TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password } : {},
      args: ["--private-key-path", resolve(process.cwd(), privateKeyPath)],
      sourceLabel: "TAURI_SIGNING_PRIVATE_KEY_PATH",
    }
  }

  throw new Error(
    "Missing signing key. Set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH before running release:prepare."
  )
}

async function readSignatureFromFile(archivePath) {
  const signaturePath = `${archivePath}.sig`
  try {
    const signature = (await readFile(signaturePath, "utf8")).trim()
    return signature.length > 0 ? signature : null
  } catch {
    return null
  }
}

function extractSignature(output) {
  for (const line of output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).reverse()) {
    if (/^[A-Za-z0-9+/=]+$/.test(line) && line.length > 40) {
      return line
    }

    const match = line.match(/signature(?:\s+is)?[:\s]+([A-Za-z0-9+/=]+)/i)
    if (match?.[1]) {
      return match[1]
    }
  }

  return null
}

async function signArchive(archivePath, signing) {
  const childEnv = { ...process.env, ...signing.env }
  const args = ["tauri", "signer", "sign", ...signing.args, archivePath]
  const { stdout, stderr } = await execFileAsync("pnpm", args, {
    cwd: process.cwd(),
    env: childEnv,
    maxBuffer: 1024 * 1024,
  })

  const fileSignature = await readSignatureFromFile(archivePath)
  if (fileSignature) {
    return { signature: fileSignature, stdout, stderr }
  }

  const extractedSignature = extractSignature(`${stdout}\n${stderr}`)
  if (!extractedSignature) {
    throw new Error("Signing succeeded but no signature could be read from signer output or .sig file.")
  }

  return { signature: extractedSignature, stdout, stderr }
}

async function main() {
  const { configPath, productName, version } = await readTauriConfig()
  if (!productName || !version) {
    throw new Error(`Could not read productName/version from ${configPath}.`)
  }

  const archivePath = await resolveArchivePath(productName)
  const signing = resolveSigningEnv()
  const releaseTag = process.env.RELEASE_TAG?.trim() || `v${version}`
  const releaseRepo = process.env.RELEASE_REPO?.trim() || "imrj05/vox-app"
  const assetName = basename(archivePath)
  const downloadUrl = `https://github.com/${releaseRepo}/releases/download/${releaseTag}/${assetName}`
  const { signature } = await signArchive(archivePath, signing)
  const manifestPath = await writeUpdaterManifest({
    version,
    notes: process.env.RELEASE_NOTES ?? "",
    pubDate: process.env.RELEASE_DATE ?? new Date().toISOString(),
    platforms: {
      "darwin-aarch64": {
        signature,
        url: downloadUrl,
      },
    },
  })
  const metadataPath = resolve(process.cwd(), process.env.RELEASE_METADATA_PATH ?? "release/release-metadata.json")
  const metadata = {
    version,
    releaseTag,
    releaseRepo,
    archivePath,
    assetName,
    manifestPath,
    manifestName: basename(manifestPath),
    downloadUrl,
  }

  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8")

  console.log(`Resolved updater archive: ${archivePath}`)
  console.log(`Signing source: ${signing.sourceLabel}`)
  console.log(`Updater manifest written to ${manifestPath}`)
  console.log(`Release metadata written to ${metadataPath}`)
  console.log(`Upload these release assets:`)
  console.log(`- ${assetName}`)
  console.log(`- ${basename(manifestPath)}`)
  console.log(`Expected updater URL: ${downloadUrl}`)
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectRun) {
  await main()
}
