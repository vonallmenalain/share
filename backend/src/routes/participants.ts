import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { getDb, ParticipantRow, SpaceRow } from '../db';
import { ApiError, asyncHandler } from '../middleware/errors';
import { requireSpace } from '../middleware/auth';
import { resolveParticipant } from '../middleware/participant';
import { pinLimiter } from '../middleware/rateLimit';
import { newId } from '../lib/ids';
import { publicParticipant, renameUploaderName } from '../lib/participants';
import { optionalPin, optionalString, requireString } from '../lib/validation';

const router = Router();

router.use(requireSpace, resolveParticipant);

/** Ob in diesem Bereich ein Code (PIN) für Teilnehmer-Identitäten Pflicht ist. */
function spaceRequiresPin(spaceId: string): boolean {
  const row = getDb().prepare('SELECT require_participant_pin FROM spaces WHERE id = ?').get(spaceId) as
    | Pick<SpaceRow, 'require_participant_pin'>
    | undefined;
  return row?.require_participant_pin === 1;
}

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

/**
 * Neuen Teilnehmer anlegen (Name pro Bereich eindeutig, Gross-/Kleinschreibung
 * egal). Optional kann direkt ein Schutz-Code (PIN, 4–8 Ziffern) vergeben
 * werden – kein echtes Login, aber verhindert, dass später jemand anderes im
 * selben Bereich einfach diesen Namen wählt und in dieser Person Namen etwas
 * erfasst/bearbeitet.
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const name = requireString(req.body?.name, 'Name', { max: 60 });
    const color = optionalString(req.body?.color, 32);
    const pin = optionalPin(req.body?.pin);
    // Ist der Code in diesem Bereich Pflicht, muss beim Anlegen einer neuen
    // Identität einer vergeben werden. Als Option gibt es ihn immer, aber
    // hier wird er ggf. erzwungen.
    if (spaceRequiresPin(req.spaceId!) && !pin) {
      throw new ApiError(400, 'In diesem Bereich ist ein Code (PIN) Pflicht – bitte einen vergeben.');
    }
    const pinHash = pin ? bcrypt.hashSync(pin, 10) : null;
    const db = getDb();

    const existing = db
      .prepare('SELECT * FROM participants WHERE space_id = ? AND name = ? COLLATE NOCASE')
      .get(req.spaceId, name) as ParticipantRow | undefined;
    if (existing) {
      // Einen archivierten Teilnehmer mit gleichem Namen wieder aktivieren,
      // statt einen Fehler zu werfen – so gehen keine Finanzdaten verloren.
      // Ist die Identität mit einem Code geschützt, zählt das wie eine
      // normale Auswahl (dafür ist der eigene Verify-Endpunkt da) – hier also
      // nur reaktivieren, wenn (noch) kein Code gesetzt ist (der oben ggf.
      // erzwungene neue Code wird dabei direkt übernommen).
      if (existing.archived) {
        if (existing.pin_hash) {
          throw new ApiError(409, 'Diesen Namen gibt es bereits – bitte auswählen und Code eingeben.');
        }
        const now = new Date().toISOString();
        db.prepare(
          'UPDATE participants SET archived = 0, pin_hash = ?, pin_updated_at = ?, updated_at = ? WHERE id = ?',
        ).run(pinHash, pinHash ? now : null, now, existing.id);
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
        `INSERT INTO participants (id, space_id, name, color, archived, pin_hash, pin_updated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      ).run(id, req.spaceId, name, color, pinHash, pinHash ? now : null, now, now);
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

/**
 * Prüft den Schutz-Code einer Identität, BEVOR sie im Browser als "aktuelle
 * Person" ausgewählt wird. Hat die Person keinen Code hinterlegt, gelingt die
 * Auswahl immer (wie bisher – bewusstes Vertrauensmodell für Familie &
 * Freunde, kein echtes Login).
 */
router.post(
  '/:id/verify-pin',
  pinLimiter,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM participants WHERE id = ? AND space_id = ?')
      .get(req.params.id, req.spaceId) as ParticipantRow | undefined;
    if (!row) throw new ApiError(404, 'Teilnehmer nicht gefunden.');
    if (!row.pin_hash) return res.json({ ok: true });
    const pin = String(req.body?.pin ?? '');
    if (!pin || !bcrypt.compareSync(pin, row.pin_hash)) {
      throw new ApiError(401, 'Falscher Code.');
    }
    res.json({ ok: true });
  }),
);

/**
 * Schutz-Code einer Identität setzen, ändern oder entfernen. Ist bereits ein
 * Code hinterlegt, muss der aktuelle Code mitgeschickt werden (Beweis, dass
 * man ihn kennt). Wird der allererste Code für eine Identität gesetzt, muss
 * man sie im selben Zug im Browser gerade als "aktuelle Person" gewählt
 * haben (X-Participant-Id) – so kann niemand fremden Namen vorsorglich einen
 * Code aufzwingen und die eigentliche Person aussperren.
 */
router.patch(
  '/:id/pin',
  pinLimiter,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM participants WHERE id = ? AND space_id = ?')
      .get(req.params.id, req.spaceId) as ParticipantRow | undefined;
    if (!row) throw new ApiError(404, 'Teilnehmer nicht gefunden.');

    if (row.pin_hash) {
      const currentPin = String(req.body?.currentPin ?? '');
      if (!currentPin || !bcrypt.compareSync(currentPin, row.pin_hash)) {
        throw new ApiError(403, 'Aktueller Code stimmt nicht.');
      }
    } else if (req.participantId !== row.id) {
      throw new ApiError(403, 'Bitte diese Person zuerst als „du" auswählen.');
    }

    const newPin = optionalPin(req.body?.pin);
    const pinHash = newPin ? bcrypt.hashSync(newPin, 10) : null;
    const now = new Date().toISOString();
    db.prepare('UPDATE participants SET pin_hash = ?, pin_updated_at = ?, updated_at = ? WHERE id = ?').run(
      pinHash,
      pinHash ? now : null,
      now,
      row.id,
    );
    const updated = db.prepare('SELECT * FROM participants WHERE id = ?').get(row.id) as ParticipantRow;
    res.json({ participant: publicParticipant(updated) });
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
    // Bei einer Namensänderung auch die „Upload von …"-Zuschreibung bestehender
    // Fotos/Medien mitziehen, damit sie zum neuen Namen passt.
    renameUploaderName(req.spaceId!, row.name, name);
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
