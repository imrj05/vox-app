import Database from "@tauri-apps/plugin-sql";

let _db: Database | null = null;
let _dbPromise: Promise<Database> | null = null;

/** Returns a singleton DB connection, initialising the schema on first call. */
export async function getDb(): Promise<Database> {
  if (_db) return _db;
  if (!_dbPromise) {
    _dbPromise = Database.load("sqlite:vox.db")
      .then(async (db) => {
        await migrate(db);
        _db = db;
        return db;
      })
      .catch((error) => {
        _dbPromise = null;
        throw error;
      });
  }

  return _dbPromise;
}

async function migrate(db: Database) {
  // settings table — key/value store for all app preferences
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // transcripts table — history of completed transcriptions
  await db.execute(`
    CREATE TABLE IF NOT EXISTS transcripts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      text       TEXT    NOT NULL,
      audio_path TEXT,
      app_name   TEXT,
      duration_seconds INTEGER,
      created_at INTEGER NOT NULL
    )
  `);
  await db.execute("ALTER TABLE transcripts ADD COLUMN app_name TEXT").catch(() => {});
  await db.execute("ALTER TABLE transcripts ADD COLUMN duration_seconds INTEGER").catch(() => {});
  await db.execute("ALTER TABLE transcripts ADD COLUMN raw_text TEXT").catch(() => {});
  await db.execute("ALTER TABLE transcripts ADD COLUMN language TEXT").catch(() => {});
  await db.execute("ALTER TABLE transcripts ADD COLUMN engine TEXT").catch(() => {});

  // snippets table — voice-triggered text expansion
  await db.execute(`
    CREATE TABLE IF NOT EXISTS snippets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger    TEXT NOT NULL,
      expansion  TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  // corrections table — vocabulary corrections applied to dictations
  // ("shad can" → "shadcn"), one row per applied pair (spec §13/§17).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS corrections (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      source     TEXT NOT NULL,
      canonical  TEXT NOT NULL,
      app_name   TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_corrections_pair ON corrections (source, canonical)"
  );

  // notes table — scratchpad / voice notes
  await db.execute(`
    CREATE TABLE IF NOT EXISTS notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
}

// ── Settings helpers ───────────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = $1",
    [key]
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value]
  );
}

// ── Transcript helpers ─────────────────────────────────────────────────────────

export interface TranscriptRow {
  id: number;
  text: string;
  audio_path: string | null;
  app_name: string | null;
  duration_seconds: number | null;
  raw_text: string | null;
  language: string | null;
  /** ASR engine that produced the transcript ("whisper", "parakeet", …). */
  engine: string | null;
  created_at: number;
}

export async function saveTranscript(
  text: string,
  audioPath?: string,
  appName?: string | null,
  durationSeconds?: number | null,
  rawText?: string | null,
  language?: string | null,
  engine?: string | null
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO transcripts (text, audio_path, app_name, duration_seconds, raw_text, language, engine, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [text, audioPath ?? null, appName ?? null, durationSeconds ?? null, rawText ?? null, language ?? null, engine ?? null, Date.now()]
  );
}

export async function getTranscripts(limit = 50): Promise<TranscriptRow[]> {
  const db = await getDb();
  return db.select<TranscriptRow[]>(
    "SELECT id, text, audio_path, app_name, duration_seconds, raw_text, language, engine, created_at FROM transcripts ORDER BY created_at DESC LIMIT $1",
    [limit]
  );
}

export async function deleteTranscript(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM transcripts WHERE id = $1", [id]);
}

export async function updateTranscriptText(id: number, text: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE transcripts SET text = $1 WHERE id = $2", [text, id]);
}

export async function clearTranscripts(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM transcripts");
}

/**
 * Delete transcripts older than `olderThanDays` days. Returns the number of
 * rows removed. Used by configurable transcript retention.
 */
export async function pruneTranscripts(olderThanDays: number): Promise<number> {
  const db = await getDb();
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const result = await db.execute(
    "DELETE FROM transcripts WHERE created_at < $1",
    [cutoff]
  );
  return result.rowsAffected;
}

export async function clearAppData(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM transcripts");
  await db.execute("DELETE FROM settings");
  await db.execute("DELETE FROM snippets");
  await db.execute("DELETE FROM notes");
}

// ── Note helpers ──────────────────────────────────────────────────────────────

export interface Note {
  id: number;
  title: string;
  content: string;
  created_at: number;
  updated_at: number;
}

export async function getNotes(): Promise<Note[]> {
  const db = await getDb();
  return db.select<Note[]>(
    "SELECT id, title, content, created_at, updated_at FROM notes ORDER BY updated_at DESC"
  );
}

export async function getNote(id: number): Promise<Note | null> {
  const db = await getDb();
  const rows = await db.select<Note[]>(
    "SELECT id, title, content, created_at, updated_at FROM notes WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}

export async function saveNote(title: string, content: string): Promise<number> {
  const db = await getDb();
  const now = Date.now();
  const result = await db.execute(
    "INSERT INTO notes (title, content, created_at, updated_at) VALUES ($1, $2, $3, $4)",
    [title, content, now, now]
  );
  return result.lastInsertId ?? Date.now();
}

export async function updateNote(id: number, title: string, content: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE notes SET title = $1, content = $2, updated_at = $3 WHERE id = $4", [
    title,
    content,
    Date.now(),
    id,
  ]);
}

export async function deleteNote(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM notes WHERE id = $1", [id]);
}

// ── Snippet helpers ─────────────────────────────────────────────────────────────

export interface Snippet {
  id: number;
  trigger: string;
  expansion: string;
  created_at: number;
}

export async function getSnippets(): Promise<Snippet[]> {
  const db = await getDb();
  return db.select<Snippet[]>(
    "SELECT id, trigger, expansion, created_at FROM snippets ORDER BY created_at ASC"
  );
}

export async function saveSnippet(trigger: string, expansion: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO snippets (trigger, expansion, created_at) VALUES ($1, $2, $3)",
    [trigger, expansion, Date.now()]
  );
}

export async function updateSnippet(id: number, trigger: string, expansion: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE snippets SET trigger = $1, expansion = $2 WHERE id = $3", [
    trigger,
    expansion,
    id,
  ]);
}

export async function deleteSnippet(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM snippets WHERE id = $1", [id]);
}

// ── Vocabulary correction helpers ──────────────────────────────────────────────

export interface CorrectionPair {
  source: string;
  canonical: string;
}

/** Persist one or more corrections the vocabulary engine applied. */
export async function saveCorrections(
  corrections: CorrectionPair[],
  appName?: string | null
): Promise<void> {
  if (corrections.length === 0) return;
  const db = await getDb();
  const now = Date.now();
  for (const correction of corrections) {
    if (!correction.source.trim() || !correction.canonical.trim()) continue;
    await db.execute(
      "INSERT INTO corrections (source, canonical, app_name, created_at) VALUES ($1, $2, $3, $4)",
      [correction.source.trim(), correction.canonical.trim(), appName ?? null, now]
    );
  }
}

/** One aggregated correction: how often the app heard X and wrote Y. */
export interface CorrectionRow {
  source: string;
  canonical: string;
  count: number;
  last_used_at: number;
}

export async function getCorrections(): Promise<CorrectionRow[]> {
  const db = await getDb();
  return db.select<CorrectionRow[]>(
    `SELECT source, canonical, COUNT(*) AS count, MAX(created_at) AS last_used_at
     FROM corrections
     GROUP BY source, canonical
     ORDER BY last_used_at DESC
     LIMIT 200`
  );
}

export async function deleteCorrectionPair(source: string, canonical: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM corrections WHERE source = $1 AND canonical = $2", [
    source,
    canonical,
  ]);
}

export async function getCorrectionsStats(): Promise<{
  totalCorrections: number;
  dictationsImproved: number;
  distinctTerms: number;
}> {
  const db = await getDb();
  const pairRows = await db.select<{ total: number; terms: number }[]>(
    `SELECT COUNT(*) AS total, COUNT(DISTINCT canonical) AS terms FROM corrections`
  );
  const improved = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) AS count FROM transcripts
     WHERE raw_text IS NOT NULL AND TRIM(raw_text) != '' AND TRIM(raw_text) != TRIM(text)`
  );
  return {
    totalCorrections: pairRows[0]?.total ?? 0,
    distinctTerms: pairRows[0]?.terms ?? 0,
    dictationsImproved: improved[0]?.count ?? 0,
  };
}
