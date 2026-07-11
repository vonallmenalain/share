import { Router } from 'express';
import { getDb, ShoppingItemRow } from '../db';
import { ApiError, asyncHandler } from '../middleware/errors';
import { requireSpace } from '../middleware/auth';
import { requireEnabledModule } from '../middleware/module';
import { resolveParticipant } from '../middleware/participant';
import { newId } from '../lib/ids';
import { optionalString, requireString, toBool } from '../lib/validation';

const router = Router();

router.use(requireSpace, requireEnabledModule('shopping'), resolveParticipant);

function publicShoppingItem(row: ShoppingItemRow) {
  return {
    id: row.id,
    text: row.text,
    quantity: row.quantity,
    checked: row.checked === 1,
    checkedByParticipantId: row.checked_by_participant_id,
    checkedAt: row.checked_at,
    position: row.position,
    createdByParticipantId: row.created_by_participant_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getOwnItem(id: string, spaceId: string): ShoppingItemRow {
  const row = getDb()
    .prepare('SELECT * FROM shopping_items WHERE id = ? AND space_id = ? AND deleted_at IS NULL')
    .get(id, spaceId) as ShoppingItemRow | undefined;
  if (!row) throw new ApiError(404, 'Eintrag nicht gefunden.');
  return row;
}

/** Alle (nicht gelöschten) Einträge – offene zuerst, danach erledigte. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = getDb()
      .prepare(
        `SELECT * FROM shopping_items WHERE space_id = ? AND deleted_at IS NULL
         ORDER BY checked ASC, position ASC, created_at ASC`,
      )
      .all(req.spaceId) as ShoppingItemRow[];
    res.json({ items: rows.map(publicShoppingItem) });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const text = requireString(req.body?.text, 'Eintrag', { max: 300 });
    const quantity = optionalString(req.body?.quantity, 60);
    const db = getDb();
    const id = newId();
    const now = new Date().toISOString();
    const maxPos = db
      .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM shopping_items WHERE space_id = ?')
      .get(req.spaceId) as { m: number };
    db.prepare(
      `INSERT INTO shopping_items (id, space_id, text, quantity, checked, position, created_by_participant_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    ).run(id, req.spaceId, text, quantity, maxPos.m + 1, req.participantId ?? null, now, now);
    const row = db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(id) as ShoppingItemRow;
    res.status(201).json({ item: publicShoppingItem(row) });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = getOwnItem(req.params.id, req.spaceId!);
    const text = req.body?.text === undefined ? row.text : requireString(req.body.text, 'Eintrag', { max: 300 });
    const quantity = req.body?.quantity === undefined ? row.quantity : optionalString(req.body.quantity, 60);
    getDb()
      .prepare('UPDATE shopping_items SET text = ?, quantity = ?, updated_at = ? WHERE id = ?')
      .run(text, quantity, new Date().toISOString(), row.id);
    const updated = getDb().prepare('SELECT * FROM shopping_items WHERE id = ?').get(row.id) as ShoppingItemRow;
    res.json({ item: publicShoppingItem(updated) });
  }),
);

/** Abhaken/wieder aufheben. */
router.post(
  '/:id/toggle',
  asyncHandler(async (req, res) => {
    const row = getOwnItem(req.params.id, req.spaceId!);
    const checked = req.body?.checked === undefined ? row.checked === 0 : toBool(req.body.checked);
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE shopping_items
         SET checked = ?, checked_by_participant_id = ?, checked_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        checked ? 1 : 0,
        checked ? req.participantId ?? null : null,
        checked ? now : null,
        now,
        row.id,
      );
    const updated = getDb().prepare('SELECT * FROM shopping_items WHERE id = ?').get(row.id) as ShoppingItemRow;
    res.json({ item: publicShoppingItem(updated) });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = getOwnItem(req.params.id, req.spaceId!);
    getDb()
      .prepare('UPDATE shopping_items SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), new Date().toISOString(), row.id);
    res.json({ ok: true });
  }),
);

export default router;
