import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { consolidateParticipants } from './participants';

/**
 * Baut eine In-Memory-Datenbank mit genau den Tabellen, die eine
 * Teilnehmer-Identität referenzieren (mit denselben Fremdschlüsseln wie in
 * `db.ts`), damit `consolidateParticipants` realitätsnah – inkl. aktiver
 * Fremdschlüssel – geprüft werden kann.
 */
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE spaces (id TEXT PRIMARY KEY, name TEXT NOT NULL);

    CREATE TABLE participants (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      merged_into TEXT REFERENCES participants(id),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE finance_expenses (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL,
      paid_by_participant_id TEXT NOT NULL REFERENCES participants(id),
      created_by_participant_id TEXT REFERENCES participants(id),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE finance_expense_splits (
      expense_id TEXT NOT NULL REFERENCES finance_expenses(id) ON DELETE CASCADE,
      participant_id TEXT NOT NULL REFERENCES participants(id),
      share_cents INTEGER NOT NULL,
      PRIMARY KEY (expense_id, participant_id)
    );

    CREATE TABLE finance_settlement_batches (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      created_by_participant_id TEXT
    );

    CREATE TABLE finance_settlement_transfers (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES finance_settlement_batches(id) ON DELETE CASCADE,
      from_participant_id TEXT NOT NULL REFERENCES participants(id),
      to_participant_id TEXT NOT NULL REFERENCES participants(id),
      amount_cents INTEGER NOT NULL
    );

    CREATE TABLE shopping_items (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      checked_by_participant_id TEXT,
      created_by_participant_id TEXT
    );

    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      created_by_participant_id TEXT
    );

    CREATE TABLE calendar_events (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      created_by_participant_id TEXT
    );
  `);
  return db;
}

function seed(db: Database.Database) {
  const now = '2026-01-01T00:00:00.000Z';
  db.prepare('INSERT INTO spaces (id, name) VALUES (?, ?)').run('s1', 'Ferien');
  // a = Alain (Behalten), b = Annina (Duplikat), c = Peter, d = fremde Identität,
  // die im Finanzbereich mit dem Duplikat (b) zusammengeführt ist.
  const p = db.prepare(
    'INSERT INTO participants (id, space_id, name, merged_into, updated_at) VALUES (?, ?, ?, ?, ?)',
  );
  p.run('a', 's1', 'Alain', null, now);
  p.run('b', 's1', 'Annina', null, now);
  p.run('c', 's1', 'Peter', null, now);
  p.run('d', 's1', 'Gast', null, now);
  // Finanz-Zusammenführungen erst setzen, wenn alle Zeilen existieren (FK).
  // a war im Finanzbereich in die Quelle b gemergt, d zeigt ebenfalls auf b.
  db.prepare('UPDATE participants SET merged_into = ? WHERE id = ?').run('b', 'a');
  db.prepare('UPDATE participants SET merged_into = ? WHERE id = ?').run('b', 'd');

  const e = db.prepare(
    `INSERT INTO finance_expenses
       (id, space_id, amount_cents, paid_by_participant_id, created_by_participant_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  e.run('e1', 's1', 9000, 'b', 'b', now); // beide a & b haben einen Anteil
  e.run('e2', 's1', 4000, 'a', 'a', now); // nur a
  e.run('e3', 's1', 3000, 'c', 'c', now); // nur b hat einen Anteil

  const sp = db.prepare(
    'INSERT INTO finance_expense_splits (expense_id, participant_id, share_cents) VALUES (?, ?, ?)',
  );
  sp.run('e1', 'a', 3000);
  sp.run('e1', 'b', 3000);
  sp.run('e1', 'c', 3000);
  sp.run('e2', 'a', 2000);
  sp.run('e2', 'c', 2000);
  sp.run('e3', 'b', 1500);
  sp.run('e3', 'c', 1500);

  db.prepare(
    'INSERT INTO finance_settlement_batches (id, space_id, created_by_participant_id) VALUES (?, ?, ?)',
  ).run('sb1', 's1', 'b');
  const t = db.prepare(
    `INSERT INTO finance_settlement_transfers
       (id, batch_id, from_participant_id, to_participant_id, amount_cents) VALUES (?, ?, ?, ?, ?)`,
  );
  t.run('t1', 'sb1', 'b', 'c', 1000); // b->a : from a to c
  t.run('t2', 'sb1', 'a', 'b', 500); // wird zu a->a -> gelöscht
  t.run('t3', 'sb1', 'c', 'b', 700); // c->a

  db.prepare(
    'INSERT INTO shopping_items (id, space_id, checked_by_participant_id, created_by_participant_id) VALUES (?, ?, ?, ?)',
  ).run('sh1', 's1', 'b', 'b');
  db.prepare('INSERT INTO notes (id, space_id, created_by_participant_id) VALUES (?, ?, ?)').run(
    'n1',
    's1',
    'b',
  );
  db.prepare(
    'INSERT INTO calendar_events (id, space_id, created_by_participant_id) VALUES (?, ?, ?)',
  ).run('cal1', 's1', 'b');
}

// C1: Duplikat (b) wird endgültig in die zu behaltende Identität (a) zusammengelegt.
test('consolidate: moves all references from source into target and deletes source', () => {
  const db = makeDb();
  seed(db);

  consolidateParticipants('s1', 'b', 'a', db);

  // Quelle ist gelöscht, Ziel bleibt.
  assert.equal(db.prepare('SELECT 1 FROM participants WHERE id = ?').get('b'), undefined);
  assert.ok(db.prepare('SELECT 1 FROM participants WHERE id = ?').get('a'));

  // Ausgaben: Zahler:in und Ersteller:in von b sind jetzt a.
  const e1 = db.prepare('SELECT * FROM finance_expenses WHERE id = ?').get('e1') as {
    paid_by_participant_id: string;
    created_by_participant_id: string;
  };
  assert.equal(e1.paid_by_participant_id, 'a');
  assert.equal(e1.created_by_participant_id, 'a');

  // Anteile: e1 -> a bekommt 3000+3000, kein b-Anteil mehr.
  const share = (expense: string, pid: string) =>
    (db
      .prepare('SELECT share_cents AS s FROM finance_expense_splits WHERE expense_id = ? AND participant_id = ?')
      .get(expense, pid) as { s: number } | undefined)?.s;
  assert.equal(share('e1', 'a'), 6000);
  assert.equal(share('e1', 'c'), 3000);
  assert.equal(share('e1', 'b'), undefined);
  // e2 unverändert.
  assert.equal(share('e2', 'a'), 2000);
  // e3: nur-b-Anteil wandert komplett zu a.
  assert.equal(share('e3', 'a'), 1500);
  assert.equal(share('e3', 'b'), undefined);

  // Kein Anteil zeigt mehr auf b.
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM finance_expense_splits WHERE participant_id = ?').get('b') as { n: number }).n,
    0,
  );

  // Transfers: t2 (a<->b) ist als Selbst-Transfer entfernt; t1/t3 zeigen auf a.
  const transfers = db
    .prepare('SELECT id, from_participant_id AS f, to_participant_id AS t FROM finance_settlement_transfers ORDER BY id')
    .all() as Array<{ id: string; f: string; t: string }>;
  assert.deepEqual(transfers, [
    { id: 't1', f: 'a', t: 'c' },
    { id: 't3', f: 'c', t: 'a' },
  ]);

  // Lose Verweise + Batch-Ersteller:in umgeschrieben.
  const batchCreator = (db.prepare('SELECT created_by_participant_id AS c FROM finance_settlement_batches WHERE id = ?').get('sb1') as { c: string }).c;
  assert.equal(batchCreator, 'a');
  const sh = db.prepare('SELECT checked_by_participant_id AS ch, created_by_participant_id AS cr FROM shopping_items WHERE id = ?').get('sh1') as { ch: string; cr: string };
  assert.equal(sh.ch, 'a');
  assert.equal(sh.cr, 'a');
  assert.equal((db.prepare('SELECT created_by_participant_id AS c FROM notes WHERE id = ?').get('n1') as { c: string }).c, 'a');
  assert.equal((db.prepare('SELECT created_by_participant_id AS c FROM calendar_events WHERE id = ?').get('cal1') as { c: string }).c, 'a');

  // Finanz-Zusammenführung (merged_into): d zeigte auf b -> jetzt auf a;
  // a zeigte auf b -> jetzt gelöst (NULL).
  assert.equal((db.prepare('SELECT merged_into AS m FROM participants WHERE id = ?').get('d') as { m: string | null }).m, 'a');
  assert.equal((db.prepare('SELECT merged_into AS m FROM participants WHERE id = ?').get('a') as { m: string | null }).m, null);

  // Keine verwaisten Fremdschlüssel.
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

// C2: Zusammenlegen mit sich selbst wird abgewiesen.
test('consolidate: refuses source === target', () => {
  const db = makeDb();
  seed(db);
  assert.throws(() => consolidateParticipants('s1', 'a', 'a', db), /identisch/);
});

// C3: Ohne gemeinsame Anteile bleibt die Summe der Beträge erhalten (kein Anteil geht verloren).
test('consolidate: preserves total shares when there is no overlap', () => {
  const db = makeDb();
  seed(db);
  const before = (db.prepare('SELECT COALESCE(SUM(share_cents),0) AS s FROM finance_expense_splits').get() as { s: number }).s;
  consolidateParticipants('s1', 'b', 'a', db);
  const after = (db.prepare('SELECT COALESCE(SUM(share_cents),0) AS s FROM finance_expense_splits').get() as { s: number }).s;
  assert.equal(after, before);
});
