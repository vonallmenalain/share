import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { AccessLogRow, getDb, ItemRow, SpaceRow } from '../db';
import { ApiError, asyncHandler } from '../middleware/errors';
import { requireAdmin, requireSpace } from '../middleware/auth';
import { accessLimiter, adminLimiter } from '../middleware/rateLimit';
import { newId, newSlug, slugifyName } from '../lib/ids';
import { signAccessToken } from '../lib/auth';
import { deleteAllVariants, deleteSpaceStorage } from '../lib/media';
import { logAccess } from '../lib/access';
import { publicItem } from './items';

const router = Router();

/** Liest den (frei wählbaren) Anzeigenamen der aktuellen Person aus dem Header. */
function visitorNameOf(req: import('express').Request): string {
  const header = req.headers['x-uploader-name'];
  const raw = Array.isArray(header) ? header[0] : header;
  const value = String(raw ?? '');
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

function publicAccessLog(row: AccessLogRow) {
  return {
    id: row.id,
    at: row.at,
    kind: row.kind,
    visitor: row.visitor,
    ip: row.ip,
    userAgent: row.user_agent,
    country: row.country,
    region: row.region,
    city: row.city,
    postal: row.postal,
    latitude: row.latitude,
    longitude: row.longitude,
    timezone: row.timezone,
  };
}

function publicSpace(space: SpaceRow) {
  return {
    id: space.id,
    slug: space.slug,
    name: space.name,
    hasPassword: !!space.password_hash,
    createdAt: space.created_at,
  };
}

/** Admin: neuen Bereich anlegen. */
router.post(
  '/',
  adminLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!name) throw new ApiError(400, 'Bitte einen Namen für den Bereich angeben.');
    if (name.length > 80) throw new ApiError(400, 'Der Name ist zu lang.');

    const db = getDb();
    // Slug aus Name + kurzem Zufallsteil, garantiert eindeutig.
    let slug = '';
    for (let i = 0; i < 6; i++) {
      const candidate = [slugifyName(name), newSlug()].filter(Boolean).join('-');
      const exists = db.prepare('SELECT 1 FROM spaces WHERE slug = ?').get(candidate);
      if (!exists) {
        slug = candidate;
        break;
      }
    }
    if (!slug) slug = newSlug();

    const id = newId();
    const passwordHash = password ? bcrypt.hashSync(password, 10) : null;
    const createdAt = new Date().toISOString();
    db.prepare(
      'INSERT INTO spaces (id, slug, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, slug, name, passwordHash, createdAt);

    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(id) as SpaceRow;
    res.status(201).json({ space: publicSpace(space), accessToken: signAccessToken(id) });
  }),
);

/** Admin: alle Bereiche auflisten (Übersicht). */
router.get(
  '/',
  adminLimiter,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM spaces ORDER BY created_at DESC').all() as SpaceRow[];
    const countBy = db.prepare(
      `SELECT
         COALESCE(SUM(state = 'active'), 0)   AS active,
         COALESCE(SUM(state = 'deleted'), 0)  AS deleted
       FROM items WHERE space_id = ?`,
    );
    const accessBy = db.prepare(
      `SELECT COUNT(*) AS total, MAX(at) AS last FROM access_logs WHERE space_id = ?`,
    );
    const result = rows.map((s) => {
      const c = countBy.get(s.id) as { active: number; deleted: number };
      const a = accessBy.get(s.id) as { total: number; last: string | null };
      return {
        ...publicSpace(s),
        itemCount: c.active,
        deletedCount: c.deleted,
        accessCount: a.total,
        lastAccessAt: a.last,
      };
    });
    res.json({ spaces: result });
  }),
);

/** Admin: Bereich (inkl. aller Medien) löschen. */
router.delete(
  '/:id',
  adminLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(req.params.id) as
      | SpaceRow
      | undefined;
    if (!space) throw new ApiError(404, 'Bereich nicht gefunden.');
    db.prepare('DELETE FROM spaces WHERE id = ?').run(space.id);
    await deleteSpaceStorage(space.id);
    res.json({ ok: true });
  }),
);

/**
 * Admin: alle Medien eines Bereichs auflisten – inklusive der (weich)
 * gelöschten. Liefert zusätzlich einen kurzlebigen Zugriffs-Token für
 * denselben Bereich, damit die Admin-Oberfläche die Vorschaubilder anzeigen
 * kann (die Datei-Endpunkte verlangen einen gültigen Space-Token).
 */
router.get(
  '/:id/items',
  adminLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(req.params.id) as
      | SpaceRow
      | undefined;
    if (!space) throw new ApiError(404, 'Bereich nicht gefunden.');
    const rows = db
      .prepare('SELECT * FROM items WHERE space_id = ? ORDER BY position ASC, created_at ASC')
      .all(space.id) as ItemRow[];
    res.json({
      space: publicSpace(space),
      token: signAccessToken(space.id),
      items: rows.map(publicItem),
    });
  }),
);

/**
 * Admin: Zugriffsprotokoll eines Bereichs abrufen. NUR für den Administrator –
 * normale Nutzer:innen haben keinen Zugang zu diesem Endpunkt. Liefert die
 * einzelnen Zugriffe (neueste zuerst) sowie einige vorberechnete Kennzahlen.
 * Die Auswertung/Sortierung (pro Tag, Standort, IP, Person) übernimmt die
 * Admin-Oberfläche auf Basis dieser Liste.
 */
router.get(
  '/:id/access-logs',
  adminLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(req.params.id) as
      | SpaceRow
      | undefined;
    if (!space) throw new ApiError(404, 'Bereich nicht gefunden.');

    const limitRaw = parseInt(String(req.query.limit ?? ''), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 20000) : 5000;

    const total = (
      db.prepare('SELECT COUNT(*) AS n FROM access_logs WHERE space_id = ?').get(space.id) as {
        n: number;
      }
    ).n;
    const uniqueIps = (
      db
        .prepare(
          'SELECT COUNT(DISTINCT ip) AS n FROM access_logs WHERE space_id = ? AND ip IS NOT NULL',
        )
        .get(space.id) as { n: number }
    ).n;
    const uniqueVisitors = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT visitor) AS n FROM access_logs
             WHERE space_id = ? AND visitor IS NOT NULL AND visitor <> ''`,
        )
        .get(space.id) as { n: number }
    ).n;

    const rows = db
      .prepare('SELECT * FROM access_logs WHERE space_id = ? ORDER BY at DESC LIMIT ?')
      .all(space.id, limit) as AccessLogRow[];

    res.json({
      space: publicSpace(space),
      total,
      uniqueIps,
      uniqueVisitors,
      returned: rows.length,
      logs: rows.map(publicAccessLog),
    });
  }),
);

/** Admin: Zugriffsprotokoll eines Bereichs leeren. */
router.delete(
  '/:id/access-logs',
  adminLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const space = db.prepare('SELECT id FROM spaces WHERE id = ?').get(req.params.id) as
      | { id: string }
      | undefined;
    if (!space) throw new ApiError(404, 'Bereich nicht gefunden.');
    const info = db.prepare('DELETE FROM access_logs WHERE space_id = ?').run(space.id);
    res.json({ ok: true, removed: info.changes });
  }),
);

/** Admin: Zustand eines Mediums setzen (wiederherstellen/löschen). */
router.patch(
  '/:id/items/:itemId/state',
  adminLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const state = String(req.body?.state ?? '');
    if (!['active', 'deleted'].includes(state)) {
      throw new ApiError(400, 'Ungültiger Zustand.');
    }
    const db = getDb();
    const item = db
      .prepare('SELECT * FROM items WHERE id = ? AND space_id = ?')
      .get(req.params.itemId, req.params.id) as ItemRow | undefined;
    if (!item) throw new ApiError(404, 'Medium nicht gefunden.');
    db.prepare(`UPDATE items SET state=?, state_by='Admin', state_at=? WHERE id=?`).run(
      state,
      new Date().toISOString(),
      item.id,
    );
    const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(item.id) as ItemRow;
    res.json({ item: publicItem(updated) });
  }),
);

/** Admin: Medium endgültig löschen (Datenbankeintrag + alle Dateien). */
router.delete(
  '/:id/items/:itemId',
  adminLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const item = db
      .prepare('SELECT * FROM items WHERE id = ? AND space_id = ?')
      .get(req.params.itemId, req.params.id) as ItemRow | undefined;
    if (!item) throw new ApiError(404, 'Medium nicht gefunden.');
    db.prepare('DELETE FROM items WHERE id = ?').run(item.id);
    await deleteAllVariants(item.storage_key, item.ext);
    res.json({ ok: true });
  }),
);

/** Öffentlich: Basis-Infos zu einem Bereich (per Slug) – ob Passwort nötig ist. */
router.get(
  '/by-slug/:slug',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const space = db.prepare('SELECT * FROM spaces WHERE slug = ?').get(req.params.slug) as
      | SpaceRow
      | undefined;
    if (!space) throw new ApiError(404, 'Bereich nicht gefunden.');
    res.json({ space: publicSpace(space) });
  }),
);

/** Öffentlich: Bereich betreten (Passwort prüfen) und Access-Token erhalten. */
router.post(
  '/by-slug/:slug/access',
  accessLimiter,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const space = db.prepare('SELECT * FROM spaces WHERE slug = ?').get(req.params.slug) as
      | SpaceRow
      | undefined;
    if (!space) throw new ApiError(404, 'Bereich nicht gefunden.');

    if (space.password_hash) {
      const password = String(req.body?.password ?? '');
      if (!password || !bcrypt.compareSync(password, space.password_hash)) {
        throw new ApiError(401, 'Falsches Passwort.');
      }
    }
    // Zugriff (Betreten des Bereichs) für die Admin-Statistik protokollieren.
    const visitor = String(req.body?.name ?? '').trim() || visitorNameOf(req);
    logAccess(req, space.id, 'enter', visitor);
    res.json({ space: publicSpace(space), accessToken: signAccessToken(space.id) });
  }),
);

/** Aktueller Bereich anhand des Access-Tokens. */
router.get(
  '/current',
  requireSpace,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(req.spaceId) as
      | SpaceRow
      | undefined;
    if (!space) throw new ApiError(404, 'Bereich nicht gefunden.');
    // Öffnen des Bereichs (mit bereits gespeichertem Token) protokollieren.
    logAccess(req, space.id, 'open', visitorNameOf(req));
    res.json({ space: publicSpace(space) });
  }),
);

export default router;
