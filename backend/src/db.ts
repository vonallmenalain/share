import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config, paths } from './config';

let db: Database.Database;

/**
 * Öffnet (und erstellt bei Bedarf) die SQLite-Datenbank und legt das Schema an.
 * Die Datenbank ist eine einzelne Datei auf dem QNAP-Volume (share.db) – es gibt
 * keine externe Datenbank, alle Metadaten bleiben lokal auf dem NAS.
 */
export function initDb(): Database.Database {
  fs.mkdirSync(config.dataDir, { recursive: true });
  db = new Database(paths.db());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS spaces (
      id            TEXT PRIMARY KEY,
      slug          TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      password_hash TEXT,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS items (
      id                TEXT PRIMARY KEY,
      space_id          TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      kind              TEXT NOT NULL,            -- 'photo' | 'video'
      status            TEXT NOT NULL,            -- 'processing' | 'ready' | 'failed'
      state             TEXT NOT NULL DEFAULT 'active', -- 'active' | 'deleted'
      state_by          TEXT,                     -- Name der Person, die zuletzt gelöscht hat
      state_at          TEXT,                     -- Zeitpunkt der letzten Zustandsänderung
      uploader_name     TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      ext               TEXT NOT NULL,
      mime              TEXT NOT NULL,
      storage_key       TEXT NOT NULL,
      width             INTEGER,
      height            INTEGER,
      duration          REAL,
      size_bytes        INTEGER NOT NULL,
      taken_at          TEXT,
      position          INTEGER NOT NULL DEFAULT 0,
      favorite          INTEGER NOT NULL DEFAULT 0, -- 0 = normal, 1 = Favorit (Stern)
      created_at        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_items_space ON items(space_id);

    CREATE TABLE IF NOT EXISTS uploads (
      id             TEXT PRIMARY KEY,
      space_id       TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      uploader_name  TEXT NOT NULL,
      filename       TEXT NOT NULL,
      mime           TEXT NOT NULL,
      size_bytes     INTEGER NOT NULL,
      chunk_size     INTEGER NOT NULL,
      total_chunks   INTEGER NOT NULL,
      received       TEXT NOT NULL DEFAULT '[]',  -- JSON-Array empfangener Chunk-Indizes
      status         TEXT NOT NULL DEFAULT 'open',-- 'open' | 'completed'
      item_id        TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_uploads_space ON uploads(space_id);

    CREATE TABLE IF NOT EXISTS app_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- Zugriffsprotokoll: nur für den Administrator sichtbar. Hier wird jeder
    -- Zugriff auf einen Bereich festgehalten (wer, wann, von wo). Es liegt in
    -- derselben lokalen SQLite-Datei – es braucht KEINE externe Datenbank
    -- (kein Firebase o. Ä.). Die Standortangaben stammen aus den (optionalen)
    -- Cloudflare-Geo-Headern und sind daher nur so genau wie diese.
    CREATE TABLE IF NOT EXISTS access_logs (
      id          TEXT PRIMARY KEY,
      space_id    TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      at          TEXT NOT NULL,            -- Zeitpunkt (ISO 8601)
      kind        TEXT NOT NULL,            -- 'enter' (Bereich betreten) | 'open' (App/Seite geöffnet)
      visitor     TEXT,                     -- angezeigter Name der Person (falls bekannt)
      ip          TEXT,                     -- Client-IP (echte IP hinter Cloudflare/Proxy)
      user_agent  TEXT,                     -- Browser/Gerät
      country     TEXT,
      region      TEXT,
      city        TEXT,
      postal      TEXT,
      latitude    TEXT,
      longitude   TEXT,
      timezone    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_access_space ON access_logs(space_id, at);
  `);

  migrate(db);

  return db;
}

/** Liest einen einfachen Schlüssel/Wert-Eintrag aus app_meta. */
export function getMeta(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as
    | { value: string | null }
    | undefined;
  return row?.value ?? null;
}

/** Setzt einen einfachen Schlüssel/Wert-Eintrag in app_meta. */
export function setMeta(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO app_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

/**
 * Fügt bei bestehenden Datenbanken fehlende Spalten hinzu (idempotent). So
 * lassen sich neue Funktionen ausrollen, ohne die vorhandenen Metadaten zu
 * verlieren.
 */
function migrate(database: Database.Database) {
  const cols = database.prepare(`PRAGMA table_info(items)`).all() as Array<{ name: string }>;
  const have = new Set(cols.map((c) => c.name));
  const addColumn = (name: string, ddl: string) => {
    if (!have.has(name)) database.exec(`ALTER TABLE items ADD COLUMN ${ddl}`);
  };
  addColumn('state', `state TEXT NOT NULL DEFAULT 'active'`);
  addColumn('state_by', `state_by TEXT`);
  addColumn('state_at', `state_at TEXT`);
  // Favoriten-Markierung ("Stern"): 0 = normal, 1 = Favorit.
  addColumn('favorite', `favorite INTEGER NOT NULL DEFAULT 0`);
  // Angepasstes Vorschaubild (Thumbnail): Version zum Cache-Busting sowie die
  // tatsächlichen Masse des (ggf. zugeschnittenen) Thumbnails. Sind thumb_w/
  // thumb_h gesetzt, bestimmt sich das Seitenverhältnis der Galerie-Kachel aus
  // diesen Werten statt aus den Originalmassen.
  addColumn('thumb_version', `thumb_version INTEGER NOT NULL DEFAULT 0`);
  addColumn('thumb_w', `thumb_w INTEGER`);
  addColumn('thumb_h', `thumb_h INTEGER`);
  // Der Index wird bewusst erst hier erstellt – nach dem Hinzufügen der Spalte.
  // Läge er im Schema-Block oben, würde er bei bestehenden Datenbanken (in denen
  // "items" bereits ohne "state" existiert) mit "no such column: state" fehlschlagen.
  database.exec(`CREATE INDEX IF NOT EXISTS idx_items_state ON items(space_id, state)`);
  // Die frühere "Archivieren"-Funktion wurde entfernt. Es gibt nur noch "aktiv"
  // und "gelöscht". Bereits archivierte Medien werden als (weich) gelöscht
  // behandelt – der Administrator kann sie weiterhin wiederherstellen oder
  // endgültig entfernen.
  database.exec(`UPDATE items SET state = 'deleted' WHERE state = 'archived'`);
}

export function getDb(): Database.Database {
  if (!db) throw new Error('DB not initialised – call initDb() first');
  return db;
}

export interface SpaceRow {
  id: string;
  slug: string;
  name: string;
  password_hash: string | null;
  created_at: string;
}

export interface ItemRow {
  id: string;
  space_id: string;
  kind: 'photo' | 'video';
  status: 'processing' | 'ready' | 'failed';
  state: 'active' | 'deleted';
  state_by: string | null;
  state_at: string | null;
  uploader_name: string;
  original_filename: string;
  ext: string;
  mime: string;
  storage_key: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  size_bytes: number;
  taken_at: string | null;
  position: number;
  favorite: number;
  thumb_version: number;
  thumb_w: number | null;
  thumb_h: number | null;
  created_at: string;
}

export interface AccessLogRow {
  id: string;
  space_id: string;
  at: string;
  kind: 'enter' | 'open';
  visitor: string | null;
  ip: string | null;
  user_agent: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  postal: string | null;
  latitude: string | null;
  longitude: string | null;
  timezone: string | null;
}

export interface UploadRow {
  id: string;
  space_id: string;
  uploader_name: string;
  filename: string;
  mime: string;
  size_bytes: number;
  chunk_size: number;
  total_chunks: number;
  received: string;
  status: 'open' | 'completed';
  item_id: string | null;
  created_at: string;
  updated_at: string;
}

export { path };
