import Database from "@tauri-apps/plugin-sql";

let _db: Database | null = null;

/** Returns a singleton DB connection, initialising the schema on first call. */
export async function getDb(): Promise<Database> {
  if (_db) return _db;
  _db = await Database.load("sqlite:vox.db");
  await migrate(_db);
  return _db;
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
      created_at INTEGER NOT NULL
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
  created_at: number;
}

export async function saveTranscript(
  text: string,
  audioPath?: string
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO transcripts (text, audio_path, created_at) VALUES ($1, $2, $3)",
    [text, audioPath ?? null, Date.now()]
  );
}

export async function getTranscripts(limit = 50): Promise<TranscriptRow[]> {
  const db = await getDb();
  return db.select<TranscriptRow[]>(
    "SELECT id, text, audio_path, created_at FROM transcripts ORDER BY created_at DESC LIMIT $1",
    [limit]
  );
}

export async function deleteTranscript(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM transcripts WHERE id = $1", [id]);
}
