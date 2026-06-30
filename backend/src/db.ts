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
  `);

  return db;
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
  created_at: string;
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
