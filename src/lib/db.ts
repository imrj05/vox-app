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
  created_at: number;
}

export async function saveTranscript(
  text: string,
  audioPath?: string,
  appName?: string | null,
  durationSeconds?: number | null,
  rawText?: string | null
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO transcripts (text, audio_path, app_name, duration_seconds, raw_text, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [text, audioPath ?? null, appName ?? null, durationSeconds ?? null, rawText ?? null, Date.now()]
  );
}

export async function getTranscripts(limit = 50): Promise<TranscriptRow[]> {
  const db = await getDb();
  return db.select<TranscriptRow[]>(
    "SELECT id, text, audio_path, app_name, duration_seconds, raw_text, created_at FROM transcripts ORDER BY created_at DESC LIMIT $1",
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

export async function clearAppData(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM transcripts");
  await db.execute("DELETE FROM settings");
}
