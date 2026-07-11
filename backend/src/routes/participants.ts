import { Router } from 'express';
import { getDb, ParticipantRow } from '../db';
import { ApiError, asyncHandler } from '../middleware/errors';
import { requireSpace } from '../middleware/auth';
import { newId } from '../lib/ids';
import { publicParticipant } from '../lib/participants';
import { optionalString, requireString } from '../lib/validation';

const router = Router();

router.use(requireSpace);

/** Alle Teilnehmer eines Bereichs (standardmässig ohne archivierte). */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const includeArchived = req.query.includeArchived === '1' || req.query.includeArchived === 'true';
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM participants WHERE space_id = ?
         ${includeArchived ? '' : 'AND archived = 0'}
         ORDER BY archived ASC, name COLLATE NOCASE ASC`,
      )
      .all(req.spaceId) as ParticipantRow[];
    res.json({ participants: rows.map(publicParticipant) });
  }),
);

/** Neuen Teilnehmer anlegen (Name pro Bereich eindeutig, Gross-/Kleinschreibung egal). */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const name = requireString(req.body?.name, 'Name', { max: 60 });
    const color = optionalString(req.body?.color, 32);
    const db = getDb();

    const existing = db
      .prepare('SELECT * FROM participants WHERE space_id = ? AND name = ? COLLATE NOCASE')
      .get(req.spaceId, name) as ParticipantRow | undefined;
    if (existing) {
      // Einen archivierten Teilnehmer mit gleichem Namen wieder aktivieren,
      // statt einen Fehler zu werfen – so gehen keine Finanzdaten verloren.
      if (existing.archived) {
        db.prepare('UPDATE participants SET archived = 0, updated_at = ? WHERE id = ?').run(
          new Date().toISOString(),
          existing.id,
        );
        const updated = db.prepare('SELECT * FROM participants WHERE id = ?').get(existing.id) as
          | ParticipantRow
          | undefined;
        return res.status(200).json({ participant: publicParticipant(updated!) });
      }
      throw new ApiError(409, 'Diesen Namen gibt es in diesem Bereich bereits.');
    }

    const id = newId();
    const now = new Date().toISOString();
    try {
      db.prepare(
        `INSERT INTO participants (id, space_id, name, color, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      ).run(id, req.spaceId, name, color, now, now);
    } catch (err) {
      if (err instanceof Error && /UNIQUE/i.test(err.message)) {
        throw new ApiError(409, 'Diesen Namen gibt es in diesem Bereich bereits.');
      }
      throw err;
    }
    const row = db.prepare('SELECT * FROM participants WHERE id = ?').get(id) as ParticipantRow;
    res.status(201).json({ participant: publicParticipant(row) });
  }),
);

/** Teilnehmer bearbeiten (Name/Farbe). */
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM participants WHERE id = ? AND space_id = ?')
      .get(req.params.id, req.spaceId) as ParticipantRow | undefined;
    if (!row) throw new ApiError(404, 'Teilnehmer nicht gefunden.');

    const name = req.body?.name === undefined ? row.name : requireString(req.body.name, 'Name', { max: 60 });
    const color = req.body?.color === undefined ? row.color : optionalString(req.body.color, 32);

    if (name.toLowerCase() !== row.name.toLowerCase()) {
      const dup = db
        .prepare('SELECT 1 FROM participants WHERE space_id = ? AND name = ? COLLATE NOCASE AND id <> ?')
        .get(req.spaceId, name, row.id);
      if (dup) throw new ApiError(409, 'Diesen Namen gibt es in diesem Bereich bereits.');
    }

    db.prepare('UPDATE participants SET name = ?, color = ?, updated_at = ? WHERE id = ?').run(
      name,
      color,
      new Date().toISOString(),
      row.id,
    );
    const updated = db.prepare('SELECT * FROM participants WHERE id = ?').get(row.id) as ParticipantRow;
    res.json({ participant: publicParticipant(updated) });
  }),
);

/** Teilnehmer archivieren (nicht endgültig löschen, damit Finanzdaten stimmen). */
router.post(
  '/:id/archive',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM participants WHERE id = ? AND space_id = ?')
      .get(req.params.id, req.spaceId) as ParticipantRow | undefined;
    if (!row) throw new ApiError(404, 'Teilnehmer nicht gefunden.');
    const archived = req.body?.archived === false ? 0 : 1;
    db.prepare('UPDATE participants SET archived = ?, updated_at = ? WHERE id = ?').run(
      archived,
      new Date().toISOString(),
      row.id,
    );
    const updated = db.prepare('SELECT * FROM participants WHERE id = ?').get(row.id) as ParticipantRow;
    res.json({ participant: publicParticipant(updated) });
  }),
);

export default router;
