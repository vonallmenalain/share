import { Router } from 'express';
import { getDb, CalendarEventRow } from '../db';
import { ApiError, asyncHandler } from '../middleware/errors';
import { requireSpace } from '../middleware/auth';
import { requireEnabledModule } from '../middleware/module';
import { resolveParticipant } from '../middleware/participant';
import { newId } from '../lib/ids';
import {
  optionalIsoTimestamp,
  optionalLocalDate,
  optionalString,
  requireIsoTimestamp,
  requireLocalDate,
  requireString,
  toBool,
} from '../lib/validation';

const router = Router();

router.use(requireSpace, requireEnabledModule('calendar'), resolveParticipant);

function publicEvent(row: CalendarEventRow) {
  return {
    id: row.id,
    title: row.title,
    startAt: row.start_at,
    endAt: row.end_at,
    allDay: row.all_day === 1,
    allDayDate: row.all_day_date,
    location: row.location,
    description: row.description,
    createdByParticipantId: row.created_by_participant_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Validiert die zeitbezogenen Felder eines Termins. Ganztägige Termine nutzen
 * ein lokales Datum (YYYY-MM-DD), zeitgebundene Termine ISO-Zeitstempel. Das
 * Ende darf nicht vor dem Beginn liegen.
 */
function parseTiming(body: {
  allDay?: unknown;
  allDayDate?: unknown;
  startAt?: unknown;
  endAt?: unknown;
}): {
  allDay: number;
  allDayDate: string | null;
  startAt: string | null;
  endAt: string | null;
} {
  const allDay = toBool(body.allDay);
  if (allDay) {
    const allDayDate = requireLocalDate(body.allDayDate, 'Datum');
    const endDate = optionalLocalDate(body.endAt, 'Enddatum');
    if (endDate && endDate < allDayDate) {
      throw new ApiError(400, 'Das Ende darf nicht vor dem Beginn liegen.');
    }
    return { allDay: 1, allDayDate, startAt: null, endAt: endDate };
  }
  const startAt = requireIsoTimestamp(body.startAt, 'Beginn');
  const endAt = optionalIsoTimestamp(body.endAt, 'Ende');
  if (endAt && new Date(endAt).getTime() < new Date(startAt).getTime()) {
    throw new ApiError(400, 'Das Ende darf nicht vor dem Beginn liegen.');
  }
  return { allDay: 0, allDayDate: null, startAt, endAt };
}

/** Termine in einem Zeitfenster (from/to als lokale Daten oder ISO). */
router.get(
  '/events',
  asyncHandler(async (req, res) => {
    const spaceId = req.spaceId!;
    const from = optionalString(req.query.from, 40);
    const to = optionalString(req.query.to, 40);
    const rows = getDb()
      .prepare(
        `SELECT * FROM calendar_events WHERE space_id = ? AND deleted_at IS NULL
         ORDER BY COALESCE(all_day_date, substr(start_at, 1, 10)) ASC, all_day DESC, start_at ASC`,
      )
      .all(spaceId) as CalendarEventRow[];

    // Filterung in JS, da all-day (Datum) und zeitgebundene Events unterschiedlich
    // gespeichert werden. from/to sind inklusive und beziehen sich auf das Datum.
    const filtered = rows.filter((r) => {
      const day = r.all_day ? r.all_day_date : (r.start_at ? r.start_at.slice(0, 10) : null);
      if (!day) return true;
      if (from && day < from.slice(0, 10)) return false;
      if (to && day > to.slice(0, 10)) return false;
      return true;
    });
    res.json({ events: filtered.map(publicEvent) });
  }),
);

router.post(
  '/events',
  asyncHandler(async (req, res) => {
    const spaceId = req.spaceId!;
    const title = requireString(req.body?.title, 'Titel', { max: 200 });
    const location = optionalString(req.body?.location, 200);
    const description = optionalString(req.body?.description, 2000);
    const timing = parseTiming(req.body ?? {});

    const db = getDb();
    const id = newId();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO calendar_events
        (id, space_id, title, start_at, end_at, all_day, all_day_date, location, description, created_by_participant_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      spaceId,
      title,
      timing.startAt,
      timing.endAt,
      timing.allDay,
      timing.allDayDate,
      location,
      description,
      req.participantId ?? null,
      now,
      now,
    );
    const row = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id) as CalendarEventRow;
    res.status(201).json({ event: publicEvent(row) });
  }),
);

function getOwnEvent(id: string, spaceId: string): CalendarEventRow {
  const row = getDb()
    .prepare('SELECT * FROM calendar_events WHERE id = ? AND space_id = ? AND deleted_at IS NULL')
    .get(id, spaceId) as CalendarEventRow | undefined;
  if (!row) throw new ApiError(404, 'Termin nicht gefunden.');
  return row;
}

router.patch(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const spaceId = req.spaceId!;
    const existing = getOwnEvent(req.params.id, spaceId);
    const title = req.body?.title === undefined ? existing.title : requireString(req.body.title, 'Titel', { max: 200 });
    const location = req.body?.location === undefined ? existing.location : optionalString(req.body.location, 200);
    const description = req.body?.description === undefined ? existing.description : optionalString(req.body.description, 2000);

    // Timing nur neu validieren, wenn zeitbezogene Felder mitgeschickt wurden.
    const timingProvided =
      req.body?.allDay !== undefined ||
      req.body?.allDayDate !== undefined ||
      req.body?.startAt !== undefined ||
      req.body?.endAt !== undefined;
    const timing = timingProvided
      ? parseTiming(req.body ?? {})
      : {
          allDay: existing.all_day,
          allDayDate: existing.all_day_date,
          startAt: existing.start_at,
          endAt: existing.end_at,
        };

    getDb()
      .prepare(
        `UPDATE calendar_events
         SET title = ?, start_at = ?, end_at = ?, all_day = ?, all_day_date = ?, location = ?, description = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        title,
        timing.startAt,
        timing.endAt,
        timing.allDay,
        timing.allDayDate,
        location,
        description,
        new Date().toISOString(),
        existing.id,
      );
    const row = getDb().prepare('SELECT * FROM calendar_events WHERE id = ?').get(existing.id) as CalendarEventRow;
    res.json({ event: publicEvent(row) });
  }),
);

router.delete(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const existing = getOwnEvent(req.params.id, req.spaceId!);
    getDb()
      .prepare('UPDATE calendar_events SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), new Date().toISOString(), existing.id);
    res.json({ ok: true });
  }),
);

export default router;
