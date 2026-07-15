import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canModifyExpense,
  computeBalances,
  computeEqualShares,
  computeSettlement,
  isExpenseEditable,
  participantsAllBelong,
  validateSplits,
  Balance,
  ExpenseForBalance,
} from './finance';

function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

// 1. Eine Person bezahlt, alle teilen gleich.
test('1: one payer, everyone splits equally', () => {
  const splits = computeEqualShares(9000, ['a', 'b', 'c']);
  assert.deepEqual(
    splits.map((s) => s.shareCents),
    [3000, 3000, 3000],
  );
  const expenses: ExpenseForBalance[] = [{ paidByParticipantId: 'a', amountCents: 9000, splits }];
  const balances = computeBalances(expenses, ['a', 'b', 'c']);
  const byId = Object.fromEntries(balances.map((b) => [b.participantId, b.balanceCents]));
  assert.equal(byId.a, 6000); // bezahlt 9000, eigener Anteil 3000
  assert.equal(byId.b, -3000);
  assert.equal(byId.c, -3000);
});

// 2. Nur zwei von vier Personen sind beteiligt.
test('2: only two of four participate', () => {
  const splits = computeEqualShares(5000, ['a', 'b']);
  const expenses: ExpenseForBalance[] = [{ paidByParticipantId: 'a', amountCents: 5000, splits }];
  const balances = computeBalances(expenses, ['a', 'b', 'c', 'd']);
  const byId = Object.fromEntries(balances.map((b) => [b.participantId, b.balanceCents]));
  assert.equal(byId.a, 2500);
  assert.equal(byId.b, -2500);
  assert.equal(byId.c, 0);
  assert.equal(byId.d, 0);
});

// 3. Manuelle Beträge.
test('3: manual amounts', () => {
  const splits = [
    { participantId: 'a', shareCents: 7000 },
    { participantId: 'b', shareCents: 3000 },
  ];
  assert.equal(validateSplits(10000, splits).ok, true);
  const balances = computeBalances(
    [{ paidByParticipantId: 'b', amountCents: 10000, splits }],
    ['a', 'b'],
  );
  const byId = Object.fromEntries(balances.map((b) => [b.participantId, b.balanceCents]));
  assert.equal(byId.a, -7000);
  assert.equal(byId.b, 7000);
});

// 4. Betrag lässt sich nicht ohne Rest gleichmässig teilen.
test('4: amount not evenly divisible, deterministic remainder', () => {
  const splits = computeEqualShares(10000, ['c', 'a', 'b']); // 10000 / 3 = 3333 R1
  // Restverteilung nach sortierten IDs: a bekommt +1.
  const byId = Object.fromEntries(splits.map((s) => [s.participantId, s.shareCents]));
  assert.equal(byId.a, 3334);
  assert.equal(byId.b, 3333);
  assert.equal(byId.c, 3333);
  assert.equal(sum(splits.map((s) => s.shareCents)), 10000);
});

// 5. Mehrere Zahler und mehrere Gläubiger.
test('5: multiple payers and creditors settle correctly', () => {
  const expenses: ExpenseForBalance[] = [
    {
      paidByParticipantId: 'a',
      amountCents: 6000,
      splits: computeEqualShares(6000, ['a', 'b', 'c']),
    },
    {
      paidByParticipantId: 'b',
      amountCents: 3000,
      splits: computeEqualShares(3000, ['a', 'b', 'c']),
    },
  ];
  const balances = computeBalances(expenses, ['a', 'b', 'c']);
  assert.equal(sum(balances.map((b) => b.balanceCents)), 0);
  const transfers = computeSettlement(balances);
  // Alle Salden werden durch die Transfers exakt ausgeglichen.
  const applied = applyTransfers(balances, transfers);
  assert.ok(applied.every((b) => b.balanceCents === 0));
});

// 6. Bereits ausgeglichene Gruppe.
test('6: already balanced group yields no transfers', () => {
  const balances: Balance[] = [
    { participantId: 'a', balanceCents: 0 },
    { participantId: 'b', balanceCents: 0 },
  ];
  assert.deepEqual(computeSettlement(balances), []);
});

// 7. Drei oder mehr notwendige Transfers.
test('7: three or more transfers needed', () => {
  const balances: Balance[] = [
    { participantId: 'a', balanceCents: -100 },
    { participantId: 'b', balanceCents: -100 },
    { participantId: 'c', balanceCents: -100 },
    { participantId: 'd', balanceCents: 300 },
  ];
  const transfers = computeSettlement(balances);
  assert.equal(transfers.length, 3);
  assert.equal(sum(transfers.map((t) => t.amountCents)), 300);
  assert.ok(applyTransfers(balances, transfers).every((b) => b.balanceCents === 0));
});

// 8. Summe aller Salden ist exakt null.
test('8: sum of all balances is exactly zero', () => {
  const expenses: ExpenseForBalance[] = [
    { paidByParticipantId: 'a', amountCents: 10000, splits: computeEqualShares(10000, ['a', 'b', 'c']) },
    { paidByParticipantId: 'c', amountCents: 7777, splits: computeEqualShares(7777, ['a', 'b', 'c']) },
  ];
  const balances = computeBalances(expenses, ['a', 'b', 'c']);
  assert.equal(sum(balances.map((b) => b.balanceCents)), 0);
});

// 9. Summe aller Transfers entspricht exakt den Schulden.
test('9: sum of transfers equals total debt', () => {
  const balances: Balance[] = [
    { participantId: 'a', balanceCents: -4500 },
    { participantId: 'b', balanceCents: -2500 },
    { participantId: 'c', balanceCents: 7000 },
  ];
  const transfers = computeSettlement(balances);
  const totalDebt = 4500 + 2500;
  assert.equal(sum(transfers.map((t) => t.amountCents)), totalDebt);
});

// 10. Ungültige manuelle Split-Summe wird abgelehnt.
test('10: invalid manual split sum is rejected', () => {
  const result = validateSplits(10000, [
    { participantId: 'a', shareCents: 7000 },
    { participantId: 'b', shareCents: 2000 },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /Summe/);
});

// 11. Teilnehmer aus einem fremden Space wird abgelehnt.
test('11: participant from a foreign space is rejected', () => {
  const spaceParticipants = ['a', 'b', 'c'];
  assert.equal(participantsAllBelong(['a', 'b'], spaceParticipants), true);
  assert.equal(participantsAllBelong(['a', 'foreign'], spaceParticipants), false);
});

// 12. Abgerechnete Ausgabe kann nicht bearbeitet werden.
test('12: settled expense cannot be edited', () => {
  assert.equal(isExpenseEditable('open'), true);
  assert.equal(isExpenseEditable('settled'), false);
});

// 13. Nur der Ersteller darf eine Ausgabe bearbeiten/löschen.
test('13: only the creator may modify an expense', () => {
  // Ersteller selbst darf.
  assert.equal(canModifyExpense('a', 'a'), true);
  // Fremde Person darf nicht.
  assert.equal(canModifyExpense('a', 'b'), false);
  // Ohne Identität (kein X-Participant-Id) darf man fremde Ausgaben nicht ändern.
  assert.equal(canModifyExpense('a', undefined), false);
  assert.equal(canModifyExpense('a', null), false);
  // Altbestand ohne hinterlegten Ersteller bleibt für alle bearbeitbar.
  assert.equal(canModifyExpense(null, 'a'), true);
  assert.equal(canModifyExpense(null, undefined), true);
  assert.equal(canModifyExpense(undefined, 'a'), true);
});

// Zusätzliche Prüfungen zur Validierung
test('extra: equal split with single participant gets full amount', () => {
  assert.deepEqual(computeEqualShares(4200, ['x']), [{ participantId: 'x', shareCents: 4200 }]);
});

test('extra: validateSplits rejects zero amount and empty splits', () => {
  assert.equal(validateSplits(0, [{ participantId: 'a', shareCents: 0 }]).ok, false);
  assert.equal(validateSplits(100, []).ok, false);
});

// Hilfsfunktion: wendet Transfers auf die Salden an – danach müssen alle 0 sein.
function applyTransfers(balances: Balance[], transfers: { fromParticipantId: string; toParticipantId: string; amountCents: number }[]): Balance[] {
  const map = new Map(balances.map((b) => [b.participantId, b.balanceCents]));
  for (const t of transfers) {
    map.set(t.fromParticipantId, (map.get(t.fromParticipantId) ?? 0) + t.amountCents);
    map.set(t.toParticipantId, (map.get(t.toParticipantId) ?? 0) - t.amountCents);
  }
  return [...map.entries()].map(([participantId, balanceCents]) => ({ participantId, balanceCents }));
}
