import { Router } from 'express';
import {
  getDb,
  FinanceExpenseRow,
  FinanceExpenseSplitRow,
  FinanceSettlementBatchRow,
  FinanceSettlementTransferRow,
  ParticipantRow,
} from '../db';
import { ApiError, asyncHandler } from '../middleware/errors';
import { requireSpace } from '../middleware/auth';
import { requireEnabledModule } from '../middleware/module';
import { resolveParticipant } from '../middleware/participant';
import { newId } from '../lib/ids';
import { canonicalId, loadMergeMap, publicParticipant } from '../lib/participants';
import {
  optionalString,
  requireAmountCents,
  requireLocalDate,
  requireString,
} from '../lib/validation';
import {
  Balance,
  canModifyExpense,
  canonicalizeExpenses,
  computeBalances,
  computeEqualShares,
  computeSettlement,
  ExpenseForBalance,
  SplitShare,
  validateSplits,
} from '../lib/finance';

const router = Router();

router.use(requireSpace, requireEnabledModule('finance'), resolveParticipant);

// ---- Helfer ----------------------------------------------------------------

function financeCurrency(spaceId: string): string {
  const row = getDb()
    .prepare('SELECT currency FROM space_finance_settings WHERE space_id = ?')
    .get(spaceId) as { currency: string } | undefined;
  return row?.currency ?? 'CHF';
}

function splitsOf(expenseId: string): SplitShare[] {
  const rows = getDb()
    .prepare('SELECT participant_id, share_cents FROM finance_expense_splits WHERE expense_id = ?')
    .all(expenseId) as FinanceExpenseSplitRow[];
  return rows.map((r) => ({ participantId: r.participant_id, shareCents: r.share_cents }));
}

function publicExpense(row: FinanceExpenseRow) {
  return {
    id: row.id,
    title: row.title,
    amountCents: row.amount_cents,
    currency: row.currency,
    paidByParticipantId: row.paid_by_participant_id,
    expenseDate: row.expense_date,
    notes: row.notes,
    splitMode: row.split_mode,
    status: row.status,
    createdByParticipantId: row.created_by_participant_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    splits: splitsOf(row.id),
  };
}

/**
 * Aktive Finanz-Teilnehmer, d. h. die eigenständigen bzw. „primären"
 * Identitäten (merged_into IS NULL). Zusammengeführte (sekundäre) Identitäten
 * erscheinen im Finanzbereich NICHT als eigene Zeile – sie zählen über die
 * Kanonisierung zu ihrer primären Identität. So werden z. B. Alain und Annina
 * als eine Person angezeigt und beim gleichmässigen Aufteilen einmal gezählt.
 */
function financeParticipants(spaceId: string): ParticipantRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM participants
       WHERE space_id = ? AND archived = 0 AND merged_into IS NULL
       ORDER BY name COLLATE NOCASE`,
    )
    .all(spaceId) as ParticipantRow[];
}

/** Zusammenführungs-Abbildung dieses Bereichs (ID → kanonische Wurzel-ID). */
function mergeMapOf(spaceId: string): Map<string, string> {
  return loadMergeMap(spaceId, getDb());
}

function assertParticipantInSpace(id: string, spaceId: string): ParticipantRow {
  const row = getDb()
    .prepare('SELECT * FROM participants WHERE id = ? AND space_id = ?')
    .get(id, spaceId) as ParticipantRow | undefined;
  if (!row) throw new ApiError(400, 'Ein ausgewählter Teilnehmer gehört nicht zu diesem Bereich.');
  return row;
}

/**
 * Ermittelt aus dem Request-Body die Aufteilung (Splits) und validiert sie.
 * splitMode 'equal' → gleichmässige Verteilung auf die übergebenen
 * participantIds (mit deterministischer Restverteilung). splitMode 'manual' →
 * explizite Beträge pro Teilnehmer.
 */
function buildSplits(body: unknown, amountCents: number, spaceId: string): SplitShare[] {
  const b = body as {
    splitMode?: string;
    participantIds?: unknown;
    splits?: unknown;
  };
  const mode = b.splitMode === 'manual' ? 'manual' : 'equal';
  const merge = mergeMapOf(spaceId);
  // Alle beteiligten IDs auf ihre kanonische (primäre) Identität abbilden, damit
  // zusammengeführte Personen (z. B. Alain & Annina) als eine Person zählen und
  // die gespeicherten Anteile direkt auf die primäre Identität lauten.
  const canon = (id: string) => canonicalId(merge, id);

  if (mode === 'equal') {
    const ids = Array.isArray(b.participantIds) ? b.participantIds.map((x) => String(x)) : [];
    if (ids.length === 0) throw new ApiError(400, 'Mindestens eine Person muss beteiligt sein.');
    for (const id of ids) assertParticipantInSpace(id, spaceId);
    // Kanonisieren und Duplikate entfernen: eine zusammengeführte Person wird
    // beim gleichmässigen Aufteilen genau einmal berücksichtigt.
    const canonicalIds = [...new Set(ids.map(canon))];
    return computeEqualShares(amountCents, canonicalIds);
  }

  // manual
  const raw = Array.isArray(b.splits) ? b.splits : [];
  if (raw.length === 0) throw new ApiError(400, 'Mindestens eine Person muss beteiligt sein.');
  // Anteile je kanonischer Identität aufsummieren (zusammengeführte Personen
  // fallen zu einem gemeinsamen Anteil zusammen).
  const byCanonical = new Map<string, number>();
  for (const s of raw) {
    const obj = s as { participantId?: unknown; shareCents?: unknown };
    const participantId = String(obj.participantId ?? '');
    const shareCents = typeof obj.shareCents === 'number' ? obj.shareCents : Number(obj.shareCents);
    if (!participantId) throw new ApiError(400, 'Ungültige Aufteilung.');
    if (!Number.isInteger(shareCents) || shareCents < 0) {
      throw new ApiError(400, 'Anteile müssen ganzzahlige, nicht negative Rappen sein.');
    }
    assertParticipantInSpace(participantId, spaceId);
    const id = canon(participantId);
    byCanonical.set(id, (byCanonical.get(id) ?? 0) + shareCents);
  }
  const splits: SplitShare[] = [...byCanonical.entries()].map(([participantId, shareCents]) => ({
    participantId,
    shareCents,
  }));
  const check = validateSplits(amountCents, splits);
  if (!check.ok) throw new ApiError(400, check.error ?? 'Ungültige Aufteilung.');
  return splits;
}

/**
 * Lädt die offenen (nicht gelöschten) Ausgaben eines Bereichs inkl. Splits.
 * `forBalance` ist bereits kanonisiert – zusammengeführte Identitäten sind auf
 * ihre primäre Identität abgebildet, sodass die Salden sie als eine Person
 * behandeln (auch für Ausgaben, die vor der Zusammenführung erfasst wurden).
 */
function loadOpenExpenses(spaceId: string): { rows: FinanceExpenseRow[]; forBalance: ExpenseForBalance[] } {
  const rows = getDb()
    .prepare(
      `SELECT * FROM finance_expenses
       WHERE space_id = ? AND status = 'open' AND deleted_at IS NULL
       ORDER BY expense_date DESC, created_at DESC`,
    )
    .all(spaceId) as FinanceExpenseRow[];
  const merge = mergeMapOf(spaceId);
  const raw: ExpenseForBalance[] = rows.map((r) => ({
    paidByParticipantId: r.paid_by_participant_id,
    amountCents: r.amount_cents,
    splits: splitsOf(r.id),
  }));
  const forBalance = canonicalizeExpenses(raw, (id) => canonicalId(merge, id));
  return { rows, forBalance };
}

/** Salden über die offenen Ausgaben – für alle beteiligten & aktiven Teilnehmer. */
function openBalances(spaceId: string): Balance[] {
  // Aktive Finanz-Teilnehmer sind bereits die primären Identitäten.
  const active = financeParticipants(spaceId).map((p) => p.id);
  const { forBalance } = loadOpenExpenses(spaceId);
  // Alle Teilnehmer berücksichtigen, die entweder aktiv sind oder in einer
  // offenen (kanonisierten) Ausgabe vorkommen (Zahler oder Split), damit keine
  // Schulden "verschwinden", wenn jemand zwischenzeitlich archiviert wurde.
  const ids = new Set<string>(active);
  for (const e of forBalance) {
    ids.add(e.paidByParticipantId);
    for (const s of e.splits) ids.add(s.participantId);
  }
  return computeBalances(forBalance, [...ids]);
}

// ---- Zusammenfassung -------------------------------------------------------

router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const spaceId = req.spaceId!;
    const currency = financeCurrency(spaceId);
    const participants = financeParticipants(spaceId);
    const { rows } = loadOpenExpenses(spaceId);
    const totalOpenCents = rows.reduce((s, r) => s + r.amount_cents, 0);
    const balances = openBalances(spaceId);
    const transfers = computeSettlement(balances);

    const allTimeTotal = (
      getDb()
        .prepare(
          `SELECT COALESCE(SUM(amount_cents), 0) AS t FROM finance_expenses
           WHERE space_id = ? AND deleted_at IS NULL`,
        )
        .get(spaceId) as { t: number }
    ).t;

    res.json({
      currency,
      participants: participants.map(publicParticipant),
      openExpenseCount: rows.length,
      totalOpenCents,
      totalAllTimeCents: allTimeTotal,
      balances,
      transfers,
    });
  }),
);

// ---- Ausgaben --------------------------------------------------------------

router.get(
  '/expenses',
  asyncHandler(async (req, res) => {
    const spaceId = req.spaceId!;
    const status = req.query.status === 'settled' ? 'settled' : req.query.status === 'open' ? 'open' : null;
    const rows = getDb()
      .prepare(
        `SELECT * FROM finance_expenses
         WHERE space_id = ? AND deleted_at IS NULL
         ${status ? 'AND status = ?' : ''}
         ORDER BY expense_date DESC, created_at DESC`,
      )
      .all(...(status ? [spaceId, status] : [spaceId])) as FinanceExpenseRow[];
    res.json({ expenses: rows.map(publicExpense) });
  }),
);

router.post(
  '/expenses',
  asyncHandler(async (req, res) => {
    const spaceId = req.spaceId!;
    const currency = financeCurrency(spaceId);
    const title = requireString(req.body?.title, 'Titel', { max: 200 });
    const amountCents = requireAmountCents(req.body?.amountCents);
    const expenseDate = requireLocalDate(req.body?.expenseDate);
    const notes = optionalString(req.body?.notes, 1000);
    const paidBy = assertParticipantInSpace(String(req.body?.paidByParticipantId ?? ''), spaceId);
    // Zahler auf die kanonische (primäre) Identität abbilden – eine
    // zusammengeführte Person zahlt als Gruppe.
    const paidById = canonicalId(mergeMapOf(spaceId), paidBy.id);
    const splitMode = req.body?.splitMode === 'manual' ? 'manual' : 'equal';
    const splits = buildSplits(req.body, amountCents, spaceId);

    const db = getDb();
    const id = newId();
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO finance_expenses
          (id, space_id, title, amount_cents, currency, paid_by_participant_id, expense_date, notes, split_mode, status, created_by_participant_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      ).run(
        id,
        spaceId,
        title,
        amountCents,
        currency,
        paidById,
        expenseDate,
        notes,
        splitMode,
        req.participantId ?? null,
        now,
        now,
      );
      const ins = db.prepare(
        'INSERT INTO finance_expense_splits (expense_id, participant_id, share_cents) VALUES (?, ?, ?)',
      );
      for (const s of splits) ins.run(id, s.participantId, s.shareCents);
    });
    tx();
    const row = db.prepare('SELECT * FROM finance_expenses WHERE id = ?').get(id) as FinanceExpenseRow;
    res.status(201).json({ expense: publicExpense(row) });
  }),
);

/**
 * Lädt eine veränderbare Ausgabe und stellt sicher, dass die anfragende Person
 * sie überhaupt bearbeiten/löschen darf: Sie muss zum Bereich gehören, darf
 * nicht abgerechnet sein und nur der Ersteller darf sie verändern (fremde
 * Ausgaben sind gesperrt – siehe canModifyExpense).
 */
function getEditableExpense(
  id: string,
  spaceId: string,
  requesterParticipantId: string | undefined,
): FinanceExpenseRow {
  const row = getDb()
    .prepare('SELECT * FROM finance_expenses WHERE id = ? AND space_id = ? AND deleted_at IS NULL')
    .get(id, spaceId) as FinanceExpenseRow | undefined;
  if (!row) throw new ApiError(404, 'Ausgabe nicht gefunden.');
  if (row.status === 'settled') {
    throw new ApiError(409, 'Eine bereits abgerechnete Ausgabe kann nicht verändert werden.');
  }
  if (!canModifyExpense(row.created_by_participant_id, requesterParticipantId)) {
    throw new ApiError(
      403,
      'Diese Ausgabe wurde von einer anderen Person erfasst und kann nur von dieser bearbeitet werden.',
    );
  }
  return row;
}

router.patch(
  '/expenses/:id',
  asyncHandler(async (req, res) => {
    const spaceId = req.spaceId!;
    const existing = getEditableExpense(req.params.id, spaceId, req.participantId);
    const currency = financeCurrency(spaceId);
    const title = req.body?.title === undefined ? existing.title : requireString(req.body.title, 'Titel', { max: 200 });
    const amountCents = req.body?.amountCents === undefined ? existing.amount_cents : requireAmountCents(req.body.amountCents);
    const expenseDate = req.body?.expenseDate === undefined ? existing.expense_date : requireLocalDate(req.body.expenseDate);
    const notes = req.body?.notes === undefined ? existing.notes : optionalString(req.body.notes, 1000);
    const paidBy =
      req.body?.paidByParticipantId === undefined
        ? existing.paid_by_participant_id
        : canonicalId(
            mergeMapOf(spaceId),
            assertParticipantInSpace(String(req.body.paidByParticipantId), spaceId).id,
          );

    // Splits nur neu berechnen, wenn Aufteilung oder Betrag mitgeschickt wurde.
    const splitProvided =
      req.body?.splitMode !== undefined ||
      req.body?.splits !== undefined ||
      req.body?.participantIds !== undefined ||
      req.body?.amountCents !== undefined;
    const splitMode = req.body?.splitMode === 'manual' ? 'manual' : req.body?.splitMode === 'equal' ? 'equal' : existing.split_mode;

    const db = getDb();
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE finance_expenses
         SET title = ?, amount_cents = ?, expense_date = ?, notes = ?, paid_by_participant_id = ?, split_mode = ?, currency = ?, updated_at = ?
         WHERE id = ?`,
      ).run(title, amountCents, expenseDate, notes, paidBy, splitMode, currency, now, existing.id);

      if (splitProvided) {
        const splits = buildSplits(
          { ...(req.body as object), splitMode },
          amountCents,
          spaceId,
        );
        db.prepare('DELETE FROM finance_expense_splits WHERE expense_id = ?').run(existing.id);
        const ins = db.prepare(
          'INSERT INTO finance_expense_splits (expense_id, participant_id, share_cents) VALUES (?, ?, ?)',
        );
        for (const s of splits) ins.run(existing.id, s.participantId, s.shareCents);
      } else if (amountCents !== existing.amount_cents) {
        // Betrag ohne neue Splits geändert → alte Splits ungültig. Wird oben
        // bereits durch splitProvided abgedeckt, hier nur defensiv.
        throw new ApiError(400, 'Bei geändertem Betrag muss die Aufteilung neu übermittelt werden.');
      }
    });
    tx();
    const row = db.prepare('SELECT * FROM finance_expenses WHERE id = ?').get(existing.id) as FinanceExpenseRow;
    res.json({ expense: publicExpense(row) });
  }),
);

router.delete(
  '/expenses/:id',
  asyncHandler(async (req, res) => {
    const existing = getEditableExpense(req.params.id, req.spaceId!, req.participantId);
    getDb()
      .prepare('UPDATE finance_expenses SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), new Date().toISOString(), existing.id);
    res.json({ ok: true });
  }),
);

// ---- Abrechnungen ----------------------------------------------------------

function transfersOfBatch(batchId: string): FinanceSettlementTransferRow[] {
  return getDb()
    .prepare('SELECT * FROM finance_settlement_transfers WHERE batch_id = ? ORDER BY amount_cents DESC')
    .all(batchId) as FinanceSettlementTransferRow[];
}

function publicBatch(row: FinanceSettlementBatchRow) {
  const transfers = transfersOfBatch(row.id);
  const expenseIds = (
    getDb()
      .prepare('SELECT expense_id FROM finance_settlement_expenses WHERE batch_id = ?')
      .all(row.id) as { expense_id: string }[]
  ).map((r) => r.expense_id);
  return {
    id: row.id,
    currency: row.currency,
    createdByParticipantId: row.created_by_participant_id,
    createdAt: row.created_at,
    reopenedAt: row.reopened_at,
    expenseIds,
    transfers: transfers.map((t) => ({
      id: t.id,
      fromParticipantId: t.from_participant_id,
      toParticipantId: t.to_participant_id,
      amountCents: t.amount_cents,
      paidAt: t.paid_at,
    })),
  };
}

router.get(
  '/settlements',
  asyncHandler(async (req, res) => {
    const rows = getDb()
      .prepare('SELECT * FROM finance_settlement_batches WHERE space_id = ? ORDER BY created_at DESC')
      .all(req.spaceId) as FinanceSettlementBatchRow[];
    res.json({ settlements: rows.map(publicBatch) });
  }),
);

router.post(
  '/settlements/preview',
  asyncHandler(async (req, res) => {
    const spaceId = req.spaceId!;
    const balances = openBalances(spaceId);
    const transfers = computeSettlement(balances);
    const { rows } = loadOpenExpenses(spaceId);
    res.json({
      currency: financeCurrency(spaceId),
      balances,
      transfers,
      expenseCount: rows.length,
      totalCents: rows.reduce((s, r) => s + r.amount_cents, 0),
    });
  }),
);

router.post(
  '/settlements',
  asyncHandler(async (req, res) => {
    const spaceId = req.spaceId!;
    const currency = financeCurrency(spaceId);
    const db = getDb();

    const batchId = newId();
    const now = new Date().toISOString();
    let created: FinanceSettlementBatchRow | undefined;

    const tx = db.transaction(() => {
      const rows = db
        .prepare(
          `SELECT * FROM finance_expenses WHERE space_id = ? AND status = 'open' AND deleted_at IS NULL`,
        )
        .all(spaceId) as FinanceExpenseRow[];
      if (rows.length === 0) {
        throw new ApiError(400, 'Es gibt keine offenen Ausgaben zum Abrechnen.');
      }
      const merge = mergeMapOf(spaceId);
      const forBalance: ExpenseForBalance[] = canonicalizeExpenses(
        rows.map((r) => ({
          paidByParticipantId: r.paid_by_participant_id,
          amountCents: r.amount_cents,
          splits: splitsOf(r.id),
        })),
        (id) => canonicalId(merge, id),
      );
      const ids = new Set<string>();
      for (const e of forBalance) {
        ids.add(e.paidByParticipantId);
        for (const s of e.splits) ids.add(s.participantId);
      }
      const balances = computeBalances(forBalance, [...ids]);
      const transfers = computeSettlement(balances);

      db.prepare(
        `INSERT INTO finance_settlement_batches (id, space_id, currency, created_by_participant_id, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(batchId, spaceId, currency, req.participantId ?? null, now);

      const linkExpense = db.prepare(
        'INSERT INTO finance_settlement_expenses (batch_id, expense_id) VALUES (?, ?)',
      );
      const setSettled = db.prepare(
        `UPDATE finance_expenses SET status = 'settled', updated_at = ? WHERE id = ?`,
      );
      for (const r of rows) {
        linkExpense.run(batchId, r.id);
        setSettled.run(now, r.id);
      }

      const insTransfer = db.prepare(
        `INSERT INTO finance_settlement_transfers (id, batch_id, from_participant_id, to_participant_id, amount_cents)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const t of transfers) {
        insTransfer.run(newId(), batchId, t.fromParticipantId, t.toParticipantId, t.amountCents);
      }

      created = db.prepare('SELECT * FROM finance_settlement_batches WHERE id = ?').get(batchId) as
        | FinanceSettlementBatchRow
        | undefined;
    });
    tx();
    res.status(201).json({ settlement: publicBatch(created!) });
  }),
);

router.post(
  '/settlements/:id/reopen',
  asyncHandler(async (req, res) => {
    const spaceId = req.spaceId!;
    const db = getDb();
    const batch = db
      .prepare('SELECT * FROM finance_settlement_batches WHERE id = ? AND space_id = ?')
      .get(req.params.id, spaceId) as FinanceSettlementBatchRow | undefined;
    if (!batch) throw new ApiError(404, 'Abrechnung nicht gefunden.');
    if (batch.reopened_at) throw new ApiError(409, 'Diese Abrechnung ist bereits wieder geöffnet.');

    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      const expenseIds = (
        db
          .prepare('SELECT expense_id FROM finance_settlement_expenses WHERE batch_id = ?')
          .all(batch.id) as { expense_id: string }[]
      ).map((r) => r.expense_id);
      const setOpen = db.prepare(
        `UPDATE finance_expenses SET status = 'open', updated_at = ? WHERE id = ? AND space_id = ?`,
      );
      for (const eid of expenseIds) setOpen.run(now, eid, spaceId);
      db.prepare('UPDATE finance_settlement_batches SET reopened_at = ? WHERE id = ?').run(now, batch.id);
    });
    tx();
    const updated = db.prepare('SELECT * FROM finance_settlement_batches WHERE id = ?').get(batch.id) as FinanceSettlementBatchRow;
    res.json({ settlement: publicBatch(updated) });
  }),
);

router.patch(
  '/settlements/:batchId/transfers/:transferId',
  asyncHandler(async (req, res) => {
    const spaceId = req.spaceId!;
    const db = getDb();
    const batch = db
      .prepare('SELECT * FROM finance_settlement_batches WHERE id = ? AND space_id = ?')
      .get(req.params.batchId, spaceId) as FinanceSettlementBatchRow | undefined;
    if (!batch) throw new ApiError(404, 'Abrechnung nicht gefunden.');
    const transfer = db
      .prepare('SELECT * FROM finance_settlement_transfers WHERE id = ? AND batch_id = ?')
      .get(req.params.transferId, batch.id) as FinanceSettlementTransferRow | undefined;
    if (!transfer) throw new ApiError(404, 'Zahlung nicht gefunden.');

    const paid = req.body?.paid === false ? null : new Date().toISOString();
    db.prepare('UPDATE finance_settlement_transfers SET paid_at = ? WHERE id = ?').run(paid, transfer.id);
    res.json({ settlement: publicBatch(batch) });
  }),
);

export default router;
