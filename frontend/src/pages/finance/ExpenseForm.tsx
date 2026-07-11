import { useMemo, useState } from 'react';
import { api, Expense, Participant, SplitMode } from '../../api/client';
import { centsToInput, formatMoney, parseMoneyToCents } from '../../lib/format';

/** Gleichmässige Verteilung (nur für die Live-Vorschau; Server rechnet verbindlich). */
function previewEqualShares(amountCents: number, ids: string[]): Record<string, number> {
  const sorted = [...ids].sort();
  const n = sorted.length;
  const out: Record<string, number> = {};
  if (n === 0) return out;
  const base = Math.trunc(amountCents / n);
  let rem = amountCents - base * n;
  for (const id of sorted) {
    out[id] = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem -= 1;
  }
  return out;
}

function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function ExpenseForm({
  participants,
  currency,
  token,
  participantId,
  editing,
  onClose,
  onSaved,
}: {
  participants: Participant[];
  currency: string;
  token: string;
  participantId?: string;
  editing: Expense | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const active = participants.filter((p) => !p.archived);
  const [title, setTitle] = useState(editing?.title ?? '');
  const [amountInput, setAmountInput] = useState(editing ? centsToInput(editing.amountCents) : '');
  const [paidBy, setPaidBy] = useState(
    editing?.paidByParticipantId ?? participantId ?? active[0]?.id ?? '',
  );
  const [date, setDate] = useState(editing?.expenseDate ?? todayLocal());
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [splitMode, setSplitMode] = useState<SplitMode>(editing?.splitMode ?? 'equal');

  // Beteiligte: bei „gleichmässig" per Checkbox, standardmässig alle aktiven.
  const initialSelected = editing
    ? new Set(editing.splits.map((s) => s.participantId))
    : new Set(active.map((p) => p.id));
  const [selected, setSelected] = useState<Set<string>>(initialSelected);

  // Manuelle Beträge pro Teilnehmer (in Rappen).
  const [manual, setManual] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    if (editing && editing.splitMode === 'manual') {
      for (const s of editing.splits) out[s.participantId] = centsToInput(s.shareCents);
    }
    return out;
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const amountCents = parseMoneyToCents(amountInput) ?? 0;
  const selectedIds = active.filter((p) => selected.has(p.id)).map((p) => p.id);

  const manualSumCents = useMemo(() => {
    return selectedIds.reduce((sum, id) => sum + (parseMoneyToCents(manual[id] ?? '') ?? 0), 0);
  }, [manual, selectedIds]);

  const equalPreview = useMemo(
    () => (splitMode === 'equal' ? previewEqualShares(amountCents, selectedIds) : {}),
    [splitMode, amountCents, selectedIds],
  );

  const splitOk =
    splitMode === 'equal'
      ? selectedIds.length > 0 && amountCents > 0
      : selectedIds.length > 0 && amountCents > 0 && manualSumCents === amountCents;

  const toggleParticipant = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!title.trim()) return setError('Bitte einen Titel angeben.');
    if (amountCents <= 0) return setError('Der Betrag muss grösser als null sein.');
    if (!paidBy) return setError('Bitte auswählen, wer bezahlt hat.');
    if (selectedIds.length === 0) return setError('Mindestens eine Person muss beteiligt sein.');
    if (splitMode === 'manual' && manualSumCents !== amountCents) {
      return setError('Die Summe der Anteile muss dem Betrag entsprechen.');
    }

    const body: Record<string, unknown> = {
      title: title.trim(),
      amountCents,
      paidByParticipantId: paidBy,
      expenseDate: date,
      notes: notes.trim() || undefined,
      splitMode,
    };
    if (splitMode === 'equal') {
      body.participantIds = selectedIds;
    } else {
      body.splits = selectedIds.map((id) => ({
        participantId: id,
        shareCents: parseMoneyToCents(manual[id] ?? '') ?? 0,
      }));
    }

    setBusy(true);
    try {
      if (editing) {
        await api(`/api/finance/expenses/${editing.id}`, {
          method: 'PATCH',
          token,
          participantId,
          body,
        });
      } else {
        await api('/api/finance/expenses', { method: 'POST', token, participantId, body });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal expense-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{editing ? 'Ausgabe bearbeiten' : 'Ausgabe hinzufügen'}</h2>
          <button className="btn icon-btn btn-ghost" onClick={onClose} aria-label="Schliessen">
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="modal-body">
          {error && <div className="error-box">{error}</div>}

          <div className="field">
            <label className="label">Titel</label>
            <input
              className="input"
              placeholder="z. B. Einkauf Migros"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div className="form-row">
            <div className="field" style={{ flex: 1 }}>
              <label className="label">Betrag ({currency})</label>
              <input
                className="input"
                inputMode="decimal"
                placeholder="0.00"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="label">Datum</label>
              <input
                className="input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label className="label">Bezahlt von</label>
            <select className="input" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label">Bemerkung (optional)</label>
            <input
              className="input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="optional"
            />
          </div>

          <div className="field">
            <label className="label">Aufteilung</label>
            <div className="split-toggle">
              <button
                type="button"
                className={`btn btn-sm${splitMode === 'equal' ? ' btn-primary' : ''}`}
                onClick={() => setSplitMode('equal')}
              >
                Gleichmässig
              </button>
              <button
                type="button"
                className={`btn btn-sm${splitMode === 'manual' ? ' btn-primary' : ''}`}
                onClick={() => setSplitMode('manual')}
              >
                Manuell
              </button>
            </div>

            <div className="split-list">
              {active.map((p) => {
                const isSel = selected.has(p.id);
                return (
                  <div key={p.id} className={`split-row${isSel ? '' : ' off'}`}>
                    <label className="split-name">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggleParticipant(p.id)}
                      />
                      {p.name}
                    </label>
                    {splitMode === 'equal' ? (
                      <span className="split-amount muted">
                        {isSel ? formatMoney(equalPreview[p.id] ?? 0, currency) : '–'}
                      </span>
                    ) : (
                      <input
                        className="input split-input"
                        inputMode="decimal"
                        placeholder="0.00"
                        disabled={!isSel}
                        value={manual[p.id] ?? ''}
                        onChange={(e) => setManual((m) => ({ ...m, [p.id]: e.target.value }))}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {splitMode === 'manual' && (
              <div className={`split-sum${manualSumCents === amountCents ? ' ok' : ' bad'}`}>
                Summe: {formatMoney(manualSumCents, currency)} / {formatMoney(amountCents, currency)}
                {manualSumCents === amountCents ? ' ✓' : ' – muss übereinstimmen'}
              </div>
            )}
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Abbrechen
            </button>
            <button className="btn btn-primary" disabled={busy || !splitOk}>
              {busy ? 'Speichere…' : editing ? 'Speichern' : 'Hinzufügen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
