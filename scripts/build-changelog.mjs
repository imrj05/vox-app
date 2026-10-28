import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

async function git(args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
  })

  return stdout.trim()
}

async function readVersion() {
  if (process.env.RELEASE_VERSION) return process.env.RELEASE_VERSION.trim()

  const config = JSON.parse(await readFile(resolve(process.cwd(), "src-tauri", "tauri.conf.json"), "utf8"))
  if (!config.version) throw new Error("Could not read version from src-tauri/tauri.conf.json.")
  return config.version
}

async function readPreviousTag(currentTag) {
  const tagsOutput = await git(["tag", "--sort=-creatordate"])
  const tags = tagsOutput.split("\n").map((tag) => tag.trim()).filter(Boolean)
  return tags.find((tag) => tag !== currentTag) ?? null
}

function parseCommit(line) {
  const [hash, ...subjectParts] = line.split(" ")
  const subject = subjectParts.join(" ").trim()
  const match = subject.match(/^(feat|fix|perf|refactor|docs|test|build|ci|chore|style|revert)(?:\([^)]*\))?!?:\s+(.+)$/)

  if (!match) {
    return { hash, section: "Changed", text: subject }
  }

  const [, type, summary] = match
  const sectionByType = {
    feat: "Added",
    fix: "Fixed",
    perf: "Changed",
    refactor: "Changed",
    docs: "Changed",
    test: "Changed",
    build: "Changed",
    ci: "Changed",
    chore: "Changed",
    style: "Changed",
    revert: "Changed",
  }

  return { hash, section: sectionByType[type] ?? "Changed", text: summary }
}

async function readCommits(previousTag) {
  const range = previousTag ? `${previousTag}..HEAD` : "HEAD"
  const output = await git(["log", "--pretty=format:%h %s", range])
  return output.split("\n").map((line) => line.trim()).filter(Boolean).map(parseCommit)
}

function renderSection(title, commits) {
  if (commits.length === 0) return ""

  return [`### ${title}`, "", ...commits.map((commit) => `- ${commit.text} (${commit.hash})`), ""].join("\n")
}

function renderEntry({ version, tag, date, previousTag, commits }) {
  const sections = ["Added", "Changed", "Fixed"]
    .map((section) => renderSection(section, commits.filter((commit) => commit.section === section)))
    .filter(Boolean)

  const intro = previousTag
    ? `Changes since ${previousTag}.`
    : "Initial release changelog generated from repository history."

  return [
    `## ${tag} - ${date}`,
    "",
    intro,
    "",
    sections.length > 0 ? sections.join("\n") : "### Changed\n\n- Release version prepared.\n",
  ].join("\n").trim()
}

function upsertEntry(existingChangelog, tag, entry) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const entryPattern = new RegExp(`^## ${escapedTag} - .*$(?:\n(?!## ).*)*\n*`, "gm")
  const body = existingChangelog.replace(/^# Changelog\s*/, "").replace(entryPattern, "").trim()
  return ["# Changelog", "", entry, body ? `\n${body}` : ""].join("\n").trim() + "\n"
}

async function main() {
  const version = await readVersion()
  const tag = process.env.RELEASE_TAG?.trim() || `v${version}`
  const date = process.env.RELEASE_DATE?.slice(0, 10) || new Date().toISOString().slice(0, 10)
  const previousTag = await readPreviousTag(tag)
  const commits = await readCommits(previousTag)
  const entry = renderEntry({ version, tag, date, previousTag, commits })
  const changelogPath = resolve(process.cwd(), "CHANGELOG.md")
  const releaseNotesPath = resolve(process.cwd(), "release", "release-notes.md")

  let existingChangelog = "# Changelog\n"
  try {
    existingChangelog = await readFile(changelogPath, "utf8")
  } catch {
    // A missing changelog is expected for the first generated release.
  }

  await mkdir(resolve(process.cwd(), "release"), { recursive: true })
  await writeFile(changelogPath, upsertEntry(existingChangelog, tag, entry), "utf8")
  await writeFile(releaseNotesPath, `${entry}\n`, "utf8")

  console.log(`Changelog updated for ${tag}`)
  console.log(`Release notes written to ${releaseNotesPath}`)
}

await main()
