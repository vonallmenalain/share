import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { AccessLogRow, getDb, ItemRow, ParticipantRow, SpaceRow } from '../db';
import { ApiError, asyncHandler } from '../middleware/errors';
import { requireAdmin, requireSpace } from '../middleware/auth';
import { accessLimiter, adminLimiter, pinLimiter } from '../middleware/rateLimit';
import { newId, newSlug, slugifyName } from '../lib/ids';
import { signAccessToken } from '../lib/auth';
import { deleteAllVariants, deleteSpaceStorage } from '../lib/media';
import { logAccess } from '../lib/access';
import { publicItem } from './items';
import { getEnabledModules, isModuleKey, setEnabledModules } from '../lib/modules';
import { publicParticipant } from '../lib/participants';
import { normalizeCurrency, toBool } from '../lib/validation';
import { ModuleKey } from '../db';

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

function financeCurrencyOf(spaceId: string): string | null {
  const row = getDb()
    .prepare('SELECT currency FROM space_finance_settings WHERE space_id = ?')
    .get(spaceId) as { currency: string } | undefined;
  return row?.currency ?? null;
}

function publicSpace(space: SpaceRow) {
  const modules = getEnabledModules(space.id);
  return {
    id: space.id,
    slug: space.slug,
    name: space.name,
    hasPassword: !!space.password_hash,
    createdAt: space.created_at,
    modules,
    financeCurrency: modules.includes('finance') ? financeCurrencyOf(space.id) : null,
    // Ist in diesem Bereich ein Code (PIN) für Teilnehmer-Identitäten Pflicht?
    requireParticipantPin: space.require_participant_pin === 1,
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

    // Modulauswahl: photos ist immer aktiv. Weitere Module optional.
    const requestedModules = Array.isArray(req.body?.modules)
      ? (req.body.modules.filter(isModuleKey) as ModuleKey[])
      : [];
    const modules: ModuleKey[] = Array.from(new Set<ModuleKey>(['photos', ...requestedModules]));
    // Abrechnungswährung nur relevant, wenn Finanzen aktiviert sind.
    const currency = modules.includes('finance')
      ? normalizeCurrency(req.body?.financeCurrency, 'CHF')
      : 'CHF';
    // Beim Anlegen festlegen, ob ein Code (PIN) für Teilnehmer-Identitäten in
    // diesem Bereich Pflicht ist. Als Option (freiwilliger Code) gibt es sie
    // immer – hier wird nur bestimmt, ob sie beim Anlegen erzwungen wird.
    const requireParticipantPin = toBool(req.body?.requireParticipantPin);

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

    // Space, Module und (falls nötig) Finanzkonfiguration in einer Transaktion.
    const create = db.transaction(() => {
      db.prepare(
        `INSERT INTO spaces (id, slug, name, password_hash, require_participant_pin, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, slug, name, passwordHash, requireParticipantPin ? 1 : 0, createdAt);
      setEnabledModules(id, modules, db);
      if (modules.includes('finance')) {
        db.prepare(
          `INSERT INTO space_finance_settings (space_id, currency, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(space_id) DO UPDATE SET currency = excluded.currency, updated_at = excluded.updated_at`,
        ).run(id, currency, createdAt, createdAt);
      }
    });
    create();

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
       FROM items WHERE space_id = ? AND scope = 'gallery'`,
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
      .prepare(
        `SELECT * FROM items WHERE space_id = ? AND scope = 'gallery'
         ORDER BY position ASC, created_at ASC`,
      )
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

/** Admin: aktivierte Module eines Bereichs (inkl. Finanzwährung) abrufen. */
router.get(
  '/:id/modules',
  adminLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(req.params.id) as
      | SpaceRow
      | undefined;
    if (!space) throw new ApiError(404, 'Bereich nicht gefunden.');
    res.json({
      space: publicSpace(space),
      modules: getEnabledModules(space.id),
      financeCurrency: financeCurrencyOf(space.id),
    });
  }),
);

/**
 * Admin: aktivierte Module eines Bereichs ändern. Das Fotomodul kann nicht
 * deaktiviert werden. Deaktivierte Module blenden nur aus – Daten bleiben
 * erhalten. Optional lässt sich die Abrechnungswährung setzen (nur solange
 * noch keine Ausgaben existieren, um Inkonsistenzen zu vermeiden).
 */
router.patch(
  '/:id/modules',
  adminLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(req.params.id) as
      | SpaceRow
      | undefined;
    if (!space) throw new ApiError(404, 'Bereich nicht gefunden.');

    const requested = Array.isArray(req.body?.modules)
      ? (req.body.modules.filter(isModuleKey) as ModuleKey[])
      : [];
    const modules: ModuleKey[] = Array.from(new Set<ModuleKey>(['photos', ...requested]));

    const wantCurrency =
      req.body?.financeCurrency !== undefined
        ? normalizeCurrency(req.body.financeCurrency, 'CHF')
        : null;

    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      setEnabledModules(space.id, modules, db);
      if (modules.includes('finance')) {
        const existing = financeCurrencyOf(space.id);
        const hasExpenses = !!db
          .prepare('SELECT 1 FROM finance_expenses WHERE space_id = ? LIMIT 1')
          .get(space.id);
        // Währung nur setzen, wenn noch keine existiert oder (auf Wunsch) solange
        // keine Ausgaben erfasst wurden.
        const currency = wantCurrency && !hasExpenses ? wantCurrency : existing ?? wantCurrency ?? 'CHF';
        db.prepare(
          `INSERT INTO space_finance_settings (space_id, currency, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(space_id) DO UPDATE SET currency = excluded.currency, updated_at = excluded.updated_at`,
        ).run(space.id, currency, now, now);
      }
    });
    tx();

    const updated = db.prepare('SELECT * FROM spaces WHERE id = ?').get(space.id) as SpaceRow;
    res.json({
      space: publicSpace(updated),
      modules: getEnabledModules(space.id),
      financeCurrency: financeCurrencyOf(space.id),
    });
  }),
);

/**
 * Admin: legt fest, ob ein Code (PIN) für Teilnehmer-Identitäten in diesem
 * Bereich Pflicht ist. Als Option (freiwilliger Schutz-Code) steht der Code
 * unabhängig davon immer zur Verfügung – diese Einstellung erzwingt ihn nur
 * beim Anlegen einer neuen Identität bzw. beim erneuten Auswählen einer
 * Identität ohne Code (z. B. nach einem Zurücksetzen durch den Admin).
 */
router.patch(
  '/:id/participant-policy',
  adminLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(req.params.id) as
      | SpaceRow
      | undefined;
    if (!space) throw new ApiError(404, 'Bereich nicht gefunden.');
    const requireParticipantPin = toBool(req.body?.requireParticipantPin);
    db.prepare('UPDATE spaces SET require_participant_pin = ? WHERE id = ?').run(
      requireParticipantPin ? 1 : 0,
      space.id,
    );
    const updated = db.prepare('SELECT * FROM spaces WHERE id = ?').get(space.id) as SpaceRow;
    res.json({ space: publicSpace(updated) });
  }),
);

/**
 * Admin: alle Teilnehmer-Identitäten eines Bereichs auflisten (inkl.
 * archivierter), damit von jeder Person der Code zurückgesetzt werden kann.
 */
router.get(
  '/:id/participants',
  adminLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const space = db.prepare('SELECT id FROM spaces WHERE id = ?').get(req.params.id) as
      | { id: string }
      | undefined;
    if (!space) throw new ApiError(404, 'Bereich nicht gefunden.');
    const rows = db
      .prepare(
        'SELECT * FROM participants WHERE space_id = ? ORDER BY archived ASC, name COLLATE NOCASE ASC',
      )
      .all(space.id) as ParticipantRow[];
    res.json({ participants: rows.map(publicParticipant) });
  }),
);

/**
 * Admin: den Code (PIN) einer Teilnehmer-Identität zurücksetzen (löschen).
 * Damit kann die betroffene Person beim nächsten Auswählen ihres Namens
 * einen neuen Code vergeben – gedacht für den Fall "Code vergessen": die
 * Person wendet sich an den Administrator, der den Code hier entfernt.
 */
router.post(
  '/:id/participants/:participantId/reset-pin',
  pinLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM participants WHERE id = ? AND space_id = ?')
      .get(req.params.participantId, req.params.id) as ParticipantRow | undefined;
    if (!row) throw new ApiError(404, 'Teilnehmer nicht gefunden.');
    db.prepare('UPDATE participants SET pin_hash = NULL, pin_updated_at = NULL, updated_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      row.id,
    );
    const updated = db.prepare('SELECT * FROM participants WHERE id = ?').get(row.id) as ParticipantRow;
    res.json({ participant: publicParticipant(updated) });
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
