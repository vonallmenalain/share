import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb, ItemRow, SpaceRow } from '../db';
import { ApiError, asyncHandler } from '../middleware/errors';
import { requireAdmin, requireSpace } from '../middleware/auth';
import { accessLimiter, adminLimiter } from '../middleware/rateLimit';
import { newId, newSlug, slugifyName } from '../lib/ids';
import { signAccessToken } from '../lib/auth';
import { deleteAllVariants, deleteSpaceStorage } from '../lib/media';
import { publicItem } from './items';

const router = Router();

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
         COALESCE(SUM(state = 'archived'), 0) AS archived,
         COALESCE(SUM(state = 'deleted'), 0)  AS deleted
       FROM items WHERE space_id = ?`,
    );
    const result = rows.map((s) => {
      const c = countBy.get(s.id) as { active: number; archived: number; deleted: number };
      return {
        ...publicSpace(s),
        itemCount: c.active,
        archivedCount: c.archived,
        deletedCount: c.deleted,
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
 * Admin: alle Medien eines Bereichs auflisten – inklusive archivierter und
 * (weich) gelöschter. Liefert zusätzlich einen kurzlebigen Zugriffs-Token für
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

/** Admin: Zustand eines Mediums setzen (wiederherstellen/archivieren). */
router.patch(
  '/:id/items/:itemId/state',
  adminLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const state = String(req.body?.state ?? '');
    if (!['active', 'archived', 'deleted'].includes(state)) {
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
    res.json({ space: publicSpace(space) });
  }),
);

export default router;
