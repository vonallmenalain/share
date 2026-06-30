import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb, SpaceRow } from '../db';
import { ApiError, asyncHandler } from '../middleware/errors';
import { requireAdmin, requireSpace } from '../middleware/auth';
import { newId, newSlug, slugifyName } from '../lib/ids';
import { signAccessToken } from '../lib/auth';
import { deleteSpaceStorage } from '../lib/media';

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
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM spaces ORDER BY created_at DESC').all() as SpaceRow[];
    const result = rows.map((s) => {
      const count = db.prepare('SELECT COUNT(*) AS n FROM items WHERE space_id = ?').get(s.id) as {
        n: number;
      };
      return { ...publicSpace(s), itemCount: count.n };
    });
    res.json({ spaces: result });
  }),
);

/** Admin: Bereich (inkl. aller Medien) löschen. */
router.delete(
  '/:id',
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
