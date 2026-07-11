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

  try {
    migrate(db);
  } catch (err) {
    // Bei einem Migrationsfehler den Serverstart klar abbrechen, statt mit
    // halb ausgeführter Migration weiterzulaufen.
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Datenbank-Migration fehlgeschlagen: ${message}`);
  }

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
 * Fügt bei bestehenden Datenbanken fehlende Spalten hinzu und legt die Tabellen
 * der optionalen Module (Finanzen, Einkaufsliste, Notizen, Kalender) an.
 *
 * Die Migration ist bewusst idempotent (beliebig oft ausführbar), erhält alle
 * bestehenden Daten und läuft – wo mehrere zusammengehörige Änderungen nötig
 * sind – in einer Transaktion. Schlägt sie fehl, bricht der Serverstart mit
 * einer klaren Fehlermeldung ab (siehe initDb), statt mit halb ausgeführter
 * Migration weiterzulaufen.
 */
function migrate(database: Database.Database) {
  // Hilfsfunktion zum Hinzufügen fehlender Spalten einer Tabelle (idempotent).
  const columnsOf = (table: string) =>
    new Set(
      (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );
  const addColumn = (table: string, have: Set<string>, name: string, ddl: string) => {
    if (!have.has(name)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };

  const itemCols = columnsOf('items');
  addColumn('items', itemCols, 'state', `state TEXT NOT NULL DEFAULT 'active'`);
  addColumn('items', itemCols, 'state_by', `state_by TEXT`);
  addColumn('items', itemCols, 'state_at', `state_at TEXT`);
  // Favoriten-Markierung ("Stern"): 0 = normal, 1 = Favorit.
  addColumn('items', itemCols, 'favorite', `favorite INTEGER NOT NULL DEFAULT 0`);
  // Angepasstes Vorschaubild (Thumbnail): Version zum Cache-Busting sowie die
  // tatsächlichen Masse des (ggf. zugeschnittenen) Thumbnails. Sind thumb_w/
  // thumb_h gesetzt, bestimmt sich das Seitenverhältnis der Galerie-Kachel aus
  // diesen Werten statt aus den Originalmassen.
  addColumn('items', itemCols, 'thumb_version', `thumb_version INTEGER NOT NULL DEFAULT 0`);
  addColumn('items', itemCols, 'thumb_w', `thumb_w INTEGER`);
  addColumn('items', itemCols, 'thumb_h', `thumb_h INTEGER`);
  // Kontext/Scope eines Mediums: 'gallery' = normale Fotogalerie, 'note' =
  // Bildanhang einer Notiz. Bestehende Medien sind ausnahmslos Galerie-Medien
  // (Default 'gallery'), damit sich an der Fotogalerie nichts ändert.
  addColumn('items', itemCols, 'scope', `scope TEXT NOT NULL DEFAULT 'gallery'`);

  const uploadCols = columnsOf('uploads');
  addColumn('uploads', uploadCols, 'scope', `scope TEXT NOT NULL DEFAULT 'gallery'`);
  // Optionale Zuordnung eines Uploads/Mediums zu einer Notiz.
  addColumn('uploads', uploadCols, 'note_id', `note_id TEXT`);
  addColumn('items', itemCols, 'note_id', `note_id TEXT`);

  // Der Index wird bewusst erst hier erstellt – nach dem Hinzufügen der Spalte.
  // Läge er im Schema-Block oben, würde er bei bestehenden Datenbanken (in denen
  // "items" bereits ohne "state" existiert) mit "no such column: state" fehlschlagen.
  database.exec(`CREATE INDEX IF NOT EXISTS idx_items_state ON items(space_id, state)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_items_scope ON items(space_id, scope, state)`);
  // Die frühere "Archivieren"-Funktion wurde entfernt. Es gibt nur noch "aktiv"
  // und "gelöscht". Bereits archivierte Medien werden als (weich) gelöscht
  // behandelt – der Administrator kann sie weiterhin wiederherstellen oder
  // endgültig entfernen.
  database.exec(`UPDATE items SET state = 'deleted' WHERE state = 'archived'`);
  // Sicherheitshalber alle noch NULL-Scopes (z. B. bei sehr alten Zeilen) auf
  // 'gallery' setzen – Bilder ohne Scope sind immer Galerie-Medien.
  database.exec(`UPDATE items SET scope = 'gallery' WHERE scope IS NULL`);
  database.exec(`UPDATE uploads SET scope = 'gallery' WHERE scope IS NULL`);

  // ---- Module & neue Tabellen (in einer Transaktion) ----------------------
  const migrateModules = database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS space_modules (
        space_id   TEXT NOT NULL,
        module_key TEXT NOT NULL,
        enabled    INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (space_id, module_key),
        FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_space_modules_space ON space_modules(space_id);

      CREATE TABLE IF NOT EXISTS space_finance_settings (
        space_id   TEXT PRIMARY KEY,
        currency   TEXT NOT NULL DEFAULT 'CHF',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS participants (
        id             TEXT PRIMARY KEY,
        space_id       TEXT NOT NULL,
        name           TEXT NOT NULL,
        color          TEXT,
        archived       INTEGER NOT NULL DEFAULT 0,
        pin_hash       TEXT,
        pin_updated_at TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_participants_space ON participants(space_id, archived);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_name
        ON participants(space_id, name COLLATE NOCASE);

      CREATE TABLE IF NOT EXISTS finance_expenses (
        id                        TEXT PRIMARY KEY,
        space_id                  TEXT NOT NULL,
        title                     TEXT NOT NULL,
        amount_cents              INTEGER NOT NULL,
        currency                  TEXT NOT NULL,
        paid_by_participant_id    TEXT NOT NULL,
        expense_date              TEXT NOT NULL,
        notes                     TEXT,
        split_mode                TEXT NOT NULL,
        status                    TEXT NOT NULL DEFAULT 'open',
        created_by_participant_id TEXT,
        created_at                TEXT NOT NULL,
        updated_at                TEXT NOT NULL,
        deleted_at                TEXT,
        FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
        FOREIGN KEY (paid_by_participant_id) REFERENCES participants(id),
        FOREIGN KEY (created_by_participant_id) REFERENCES participants(id)
      );
      CREATE INDEX IF NOT EXISTS idx_finance_expenses_space
        ON finance_expenses(space_id, status, deleted_at);
      CREATE INDEX IF NOT EXISTS idx_finance_expenses_date
        ON finance_expenses(space_id, expense_date);

      CREATE TABLE IF NOT EXISTS finance_expense_splits (
        expense_id     TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        share_cents    INTEGER NOT NULL,
        PRIMARY KEY (expense_id, participant_id),
        FOREIGN KEY (expense_id) REFERENCES finance_expenses(id) ON DELETE CASCADE,
        FOREIGN KEY (participant_id) REFERENCES participants(id)
      );

      CREATE TABLE IF NOT EXISTS finance_settlement_batches (
        id                        TEXT PRIMARY KEY,
        space_id                  TEXT NOT NULL,
        currency                  TEXT NOT NULL,
        created_by_participant_id TEXT,
        created_at                TEXT NOT NULL,
        reopened_at               TEXT,
        FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_finance_batches_space
        ON finance_settlement_batches(space_id, created_at);

      CREATE TABLE IF NOT EXISTS finance_settlement_expenses (
        batch_id   TEXT NOT NULL,
        expense_id TEXT NOT NULL,
        PRIMARY KEY (batch_id, expense_id),
        FOREIGN KEY (batch_id) REFERENCES finance_settlement_batches(id) ON DELETE CASCADE,
        FOREIGN KEY (expense_id) REFERENCES finance_expenses(id)
      );

      CREATE TABLE IF NOT EXISTS finance_settlement_transfers (
        id                  TEXT PRIMARY KEY,
        batch_id            TEXT NOT NULL,
        from_participant_id TEXT NOT NULL,
        to_participant_id   TEXT NOT NULL,
        amount_cents        INTEGER NOT NULL,
        paid_at             TEXT,
        FOREIGN KEY (batch_id) REFERENCES finance_settlement_batches(id) ON DELETE CASCADE,
        FOREIGN KEY (from_participant_id) REFERENCES participants(id),
        FOREIGN KEY (to_participant_id) REFERENCES participants(id)
      );
      CREATE INDEX IF NOT EXISTS idx_finance_transfers_batch
        ON finance_settlement_transfers(batch_id);

      CREATE TABLE IF NOT EXISTS shopping_items (
        id                        TEXT PRIMARY KEY,
        space_id                  TEXT NOT NULL,
        text                      TEXT NOT NULL,
        quantity                  TEXT,
        checked                   INTEGER NOT NULL DEFAULT 0,
        checked_by_participant_id TEXT,
        checked_at                TEXT,
        position                  INTEGER NOT NULL DEFAULT 0,
        created_by_participant_id TEXT,
        created_at                TEXT NOT NULL,
        updated_at                TEXT NOT NULL,
        deleted_at                TEXT,
        FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_shopping_space
        ON shopping_items(space_id, checked, deleted_at);

      CREATE TABLE IF NOT EXISTS notes (
        id                        TEXT PRIMARY KEY,
        space_id                  TEXT NOT NULL,
        title                     TEXT NOT NULL,
        note_type                 TEXT NOT NULL,
        body                      TEXT,
        pinned                    INTEGER NOT NULL DEFAULT 0,
        created_by_participant_id TEXT,
        created_at                TEXT NOT NULL,
        updated_at                TEXT NOT NULL,
        deleted_at                TEXT,
        FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_notes_space
        ON notes(space_id, deleted_at, pinned, updated_at);

      CREATE TABLE IF NOT EXISTS note_checklist_items (
        id         TEXT PRIMARY KEY,
        note_id    TEXT NOT NULL,
        text       TEXT NOT NULL,
        checked    INTEGER NOT NULL DEFAULT 0,
        position   INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_note_checklist_note
        ON note_checklist_items(note_id, position);

      CREATE TABLE IF NOT EXISTS note_attachments (
        note_id  TEXT NOT NULL,
        item_id  TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (note_id, item_id),
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (item_id) REFERENCES items(id)
      );
      CREATE INDEX IF NOT EXISTS idx_note_attachments_item ON note_attachments(item_id);

      CREATE TABLE IF NOT EXISTS calendar_events (
        id                        TEXT PRIMARY KEY,
        space_id                  TEXT NOT NULL,
        title                     TEXT NOT NULL,
        start_at                  TEXT,
        end_at                    TEXT,
        all_day                   INTEGER NOT NULL DEFAULT 0,
        all_day_date              TEXT,
        location                  TEXT,
        description               TEXT,
        created_by_participant_id TEXT,
        created_at                TEXT NOT NULL,
        updated_at                TEXT NOT NULL,
        deleted_at                TEXT,
        FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_calendar_space
        ON calendar_events(space_id, deleted_at, start_at, all_day_date);
    `);

    // Bei allen bestehenden Bereichen das (immer aktive) Fotomodul ergänzen.
    // OR IGNORE macht das idempotent (PK = space_id + module_key).
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT OR IGNORE INTO space_modules (space_id, module_key, enabled, created_at, updated_at)
         SELECT id, 'photos', 1, ?, ? FROM spaces`,
      )
      .run(now, now);
  });

  migrateModules();

  // Optionaler PIN-Schutz für Teilnehmer-Identitäten (nachträglich ergänzt).
  // Kein echtes Login – aber verhindert, dass jemand anderes im selben
  // Bereich einfach den Namen einer Person auswählt und in ihrem Namen etwas
  // erfasst/bearbeitet, sofern diese Person einen Code hinterlegt hat.
  const participantCols = columnsOf('participants');
  addColumn('participants', participantCols, 'pin_hash', `pin_hash TEXT`);
  addColumn('participants', participantCols, 'pin_updated_at', `pin_updated_at TEXT`);
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
  scope: 'gallery' | 'note';
  note_id: string | null;
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
  scope: 'gallery' | 'note';
  note_id: string | null;
  created_at: string;
  updated_at: string;
}

// ---- Module & Ferien-/Gruppenfunktionen ------------------------------------

export type ModuleKey = 'photos' | 'finance' | 'shopping' | 'notes' | 'calendar';

export interface SpaceModuleRow {
  space_id: string;
  module_key: ModuleKey;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface SpaceFinanceSettingsRow {
  space_id: string;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface ParticipantRow {
  id: string;
  space_id: string;
  name: string;
  color: string | null;
  archived: number;
  /** Bcrypt-Hash des optionalen Schutz-Codes (PIN), oder null = kein Schutz. */
  pin_hash: string | null;
  pin_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinanceExpenseRow {
  id: string;
  space_id: string;
  title: string;
  amount_cents: number;
  currency: string;
  paid_by_participant_id: string;
  expense_date: string;
  notes: string | null;
  split_mode: 'equal' | 'manual';
  status: 'open' | 'settled';
  created_by_participant_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface FinanceExpenseSplitRow {
  expense_id: string;
  participant_id: string;
  share_cents: number;
}

export interface FinanceSettlementBatchRow {
  id: string;
  space_id: string;
  currency: string;
  created_by_participant_id: string | null;
  created_at: string;
  reopened_at: string | null;
}

export interface FinanceSettlementTransferRow {
  id: string;
  batch_id: string;
  from_participant_id: string;
  to_participant_id: string;
  amount_cents: number;
  paid_at: string | null;
}

export interface ShoppingItemRow {
  id: string;
  space_id: string;
  text: string;
  quantity: string | null;
  checked: number;
  checked_by_participant_id: string | null;
  checked_at: string | null;
  position: number;
  created_by_participant_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface NoteRow {
  id: string;
  space_id: string;
  title: string;
  note_type: 'text' | 'checklist';
  body: string | null;
  pinned: number;
  created_by_participant_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface NoteChecklistItemRow {
  id: string;
  note_id: string;
  text: string;
  checked: number;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface CalendarEventRow {
  id: string;
  space_id: string;
  title: string;
  start_at: string | null;
  end_at: string | null;
  all_day: number;
  all_day_date: string | null;
  location: string | null;
  description: string | null;
  created_by_participant_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export { path };
