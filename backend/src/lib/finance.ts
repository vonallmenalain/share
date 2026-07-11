/**
 * Reine, seiteneffektfreie Finanzberechnungen. Bewusst OHNE Datenbank- oder
 * Express-Abhängigkeiten, damit sich die Logik isoliert testen lässt
 * (siehe finance.test.ts).
 *
 * Grundregeln:
 *  - Es wird ausschliesslich mit ganzzahligen Rappen/Cents gerechnet. Es gibt
 *    KEINE Fliesskomma-Rechnung mit Geldbeträgen.
 *  - Bei gleichmässiger Aufteilung werden verbleibende Rappen deterministisch
 *    anhand der sortierten Teilnehmer-IDs verteilt.
 */

export type SplitMode = 'equal' | 'manual';

export interface SplitShare {
  participantId: string;
  shareCents: number;
}

export interface ExpenseForBalance {
  paidByParticipantId: string;
  amountCents: number;
  splits: SplitShare[];
}

export interface Balance {
  participantId: string;
  /** bezahlt − eigener Anteil. Positiv = erhält Geld, negativ = schuldet Geld. */
  balanceCents: number;
}

export interface Transfer {
  fromParticipantId: string;
  toParticipantId: string;
  amountCents: number;
}

/**
 * Verteilt einen Betrag gleichmässig auf die gegebenen Teilnehmer. Der nicht
 * teilbare Rest (verbleibende Rappen) wird deterministisch auf die – nach ID
 * sortierten – ersten Teilnehmer verteilt (jeweils +1 Rappen). So ist die
 * Summe der Anteile exakt gleich dem Betrag.
 */
export function computeEqualShares(amountCents: number, participantIds: string[]): SplitShare[] {
  if (!Number.isInteger(amountCents)) {
    throw new Error('amountCents muss eine Ganzzahl sein.');
  }
  const ids = [...new Set(participantIds)].sort();
  const n = ids.length;
  if (n === 0) throw new Error('Mindestens eine Person muss beteiligt sein.');
  const base = Math.trunc(amountCents / n);
  let remainder = amountCents - base * n; // 0 .. n-1 (bei positivem Betrag)
  return ids.map((participantId) => {
    let shareCents = base;
    if (remainder > 0) {
      shareCents += 1;
      remainder -= 1;
    }
    return { participantId, shareCents };
  });
}

export interface SplitValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Prüft, ob eine Menge an Splits zu einem Betrag passt: mindestens eine Person,
 * keine negativen Anteile, keine doppelten Teilnehmer und die Summe der Anteile
 * entspricht exakt dem Betrag.
 */
export function validateSplits(amountCents: number, splits: SplitShare[]): SplitValidationResult {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, error: 'Der Betrag muss grösser als null sein.' };
  }
  if (!Array.isArray(splits) || splits.length === 0) {
    return { ok: false, error: 'Mindestens eine Person muss beteiligt sein.' };
  }
  const seen = new Set<string>();
  let sum = 0;
  for (const s of splits) {
    if (!s.participantId) return { ok: false, error: 'Ungültige Aufteilung.' };
    if (seen.has(s.participantId)) {
      return { ok: false, error: 'Ein Teilnehmer darf nur einmal in der Aufteilung vorkommen.' };
    }
    seen.add(s.participantId);
    if (!Number.isInteger(s.shareCents) || s.shareCents < 0) {
      return { ok: false, error: 'Anteile müssen ganzzahlige, nicht negative Beträge sein.' };
    }
    sum += s.shareCents;
  }
  if (sum !== amountCents) {
    return {
      ok: false,
      error: `Die Summe der Anteile (${sum}) muss dem Betrag (${amountCents}) entsprechen.`,
    };
  }
  return { ok: true };
}

/**
 * Prüft, ob alle beteiligten Teilnehmer zur erlaubten Menge (des Bereichs)
 * gehören. Wird serverseitig genutzt, um zu verhindern, dass eine fremde
 * Teilnehmer-ID (aus einem anderen Space) in eine Aufteilung gelangt.
 */
export function participantsAllBelong(participantIds: string[], allowedIds: string[]): boolean {
  const allowed = new Set(allowedIds);
  return participantIds.every((id) => allowed.has(id));
}

/** Eine bereits abgerechnete Ausgabe darf nicht mehr verändert werden. */
export function isExpenseEditable(status: string): boolean {
  return status !== 'settled';
}

/**
 * Berechnet die Salden aller Teilnehmer über die offenen Ausgaben. Der Zahler
 * bekommt den vollen Betrag gutgeschrieben, jedem beteiligten Teilnehmer wird
 * sein Anteil belastet. Die Summe aller Salden ergibt exakt null.
 */
export function computeBalances(
  expenses: ExpenseForBalance[],
  participantIds: string[],
): Balance[] {
  const balance = new Map<string, number>();
  for (const id of participantIds) balance.set(id, 0);
  const bump = (id: string, delta: number) => balance.set(id, (balance.get(id) ?? 0) + delta);

  for (const exp of expenses) {
    bump(exp.paidByParticipantId, exp.amountCents);
    for (const split of exp.splits) {
      bump(split.participantId, -split.shareCents);
    }
  }

  // Nach ID sortiert für deterministische Reihenfolge.
  return [...balance.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([participantId, balanceCents]) => ({ participantId, balanceCents }));
}

/**
 * Erzeugt aus den Salden möglichst wenige Ausgleichszahlungen. Der jeweils
 * grösste Schuldner wird mit dem grössten Gläubiger abgeglichen. Es wird
 * ausschliesslich mit Integer-Rappen gearbeitet; das Gesamtergebnis ist exakt
 * ausgeglichen (Summe aller Transfers = Summe aller Schulden).
 */
export function computeSettlement(balances: Balance[]): Transfer[] {
  const debtors = balances
    .filter((b) => b.balanceCents < 0)
    .map((b) => ({ id: b.participantId, amount: -b.balanceCents }))
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  const creditors = balances
    .filter((b) => b.balanceCents > 0)
    .map((b) => ({ id: b.participantId, amount: b.balanceCents }))
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    if (pay > 0) {
      transfers.push({
        fromParticipantId: debtors[i].id,
        toParticipantId: creditors[j].id,
        amountCents: pay,
      });
    }
    debtors[i].amount -= pay;
    creditors[j].amount -= pay;
    if (debtors[i].amount === 0) i++;
    if (creditors[j].amount === 0) j++;
  }
  return transfers;
}
