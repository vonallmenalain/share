import { useCallback, useState } from 'react';
import {
  api,
  Expense,
  FinanceSummary,
  Settlement,
} from '../../api/client';
import { useSpaceSessionContext } from '../../context/SpaceSessionContext';
import { useModuleData } from '../../lib/useModuleData';
import { participantName } from '../../lib/useParticipants';
import { formatDate, formatMoney } from '../../lib/format';
import ExpenseForm from './ExpenseForm';
import SettlementView from './SettlementView';

interface FinanceData {
  summary: FinanceSummary;
  expenses: Expense[];
  settlements: Settlement[];
}

export default function FinancePage() {
  const { token, space, identity } = useSpaceSessionContext();
  const { participants, currentId } = identity;
  const participantId = currentId ?? undefined;

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [settling, setSettling] = useState(false);

  const load = useCallback(
    async (signal: AbortSignal): Promise<FinanceData> => {
      const [summary, expensesRes, settlementsRes] = await Promise.all([
        api<FinanceSummary>('/api/finance/summary', { token, signal }),
        api<{ expenses: Expense[] }>('/api/finance/expenses', { token, signal }),
        api<{ settlements: Settlement[] }>('/api/finance/settlements', { token, signal }),
      ]);
      return { summary, expenses: expensesRes.expenses, settlements: settlementsRes.settlements };
    },
    [token],
  );

  const { data, loading, reload } = useModuleData<FinanceData>(load, [token], { intervalMs: 10000 });

  const currency = data?.summary.currency ?? space?.financeCurrency ?? 'CHF';
  const nameOf = (id: string | null | undefined) => participantName(participants, id);

  const settleNow = async () => {
    if (!confirm('Offene Ausgaben jetzt abrechnen?')) return;
    setSettling(true);
    try {
      await api('/api/finance/settlements', { method: 'POST', token, participantId });
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Abrechnung fehlgeschlagen.');
    } finally {
      setSettling(false);
    }
  };

  const toggleTransfer = async (batchId: string, transferId: string, paid: boolean) => {
    try {
      await api(`/api/finance/settlements/${batchId}/transfers/${transferId}`, {
        method: 'PATCH',
        token,
        participantId,
        body: { paid },
      });
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Aktion fehlgeschlagen.');
    }
  };

  const reopen = async (batchId: string) => {
    try {
      await api(`/api/finance/settlements/${batchId}/reopen`, { method: 'POST', token, participantId });
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Wieder öffnen fehlgeschlagen.');
    }
  };

  const deleteExpense = async (exp: Expense) => {
    if (!confirm('Diese Ausgabe löschen?')) return;
    try {
      await api(`/api/finance/expenses/${exp.id}`, { method: 'DELETE', token, participantId });
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
    }
  };

  const summary = data?.summary;
  const openExpenses = (data?.expenses ?? []).filter((e) => e.status === 'open');
  const settledExpenses = (data?.expenses ?? []).filter((e) => e.status === 'settled');

  return (
    <div className="container module-page">
      <div className="module-head finance-head">
        <h1 className="space-title">Finanzen</h1>
        <span className="module-badge">{currency}</span>
      </div>

      {loading && !data ? (
        <div className="center-page" style={{ minHeight: 160 }}>
          <span className="spinner lg" />
        </div>
      ) : (
        <>
          {summary && (
            <div className="finance-summary">
              <div className="stat-card">
                <span className="stat-label">Offene Ausgaben</span>
                <span className="stat-value">{formatMoney(summary.totalOpenCents, currency)}</span>
                <span className="stat-sub">{summary.openExpenseCount} Einträge</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Gesamt (alle)</span>
                <span className="stat-value">{formatMoney(summary.totalAllTimeCents, currency)}</span>
              </div>
            </div>
          )}

          {summary && summary.balances.length > 0 && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Salden (offene Ausgaben)</h3>
              <ul className="balance-list">
                {summary.balances
                  .filter((b) => b.balanceCents !== 0 || participants.some((p) => p.id === b.participantId && !p.archived))
                  .map((b) => {
                    const nm = nameOf(b.participantId);
                    return (
                      <li key={b.participantId} className="balance-row">
                        <span className="balance-name">{nm}</span>
                        <span
                          className={`balance-amount${b.balanceCents > 0 ? ' positive' : b.balanceCents < 0 ? ' negative' : ''}`}
                        >
                          {b.balanceCents > 0 ? 'erhält ' : b.balanceCents < 0 ? 'schuldet ' : ''}
                          {formatMoney(Math.abs(b.balanceCents), currency)}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </div>
          )}

          <div className="finance-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
            >
              + Ausgabe hinzufügen
            </button>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Offene Ausgaben</h3>
            {openExpenses.length === 0 ? (
              <p className="muted">Noch keine offenen Ausgaben.</p>
            ) : (
              <ul className="expense-list">
                {openExpenses.map((e) => (
                  <li key={e.id} className="expense-row">
                    <div className="expense-main">
                      <strong>{e.title}</strong>
                      <span className="muted">
                        {nameOf(e.paidByParticipantId)} · {formatDate(e.expenseDate)} ·{' '}
                        {e.splitMode === 'equal' ? 'gleichmässig' : 'manuell'} · {e.splits.length} Pers.
                      </span>
                      {e.notes && <span className="expense-notes">{e.notes}</span>}
                    </div>
                    <div className="expense-side">
                      <span className="expense-amount">{formatMoney(e.amountCents, currency)}</span>
                      <span className="expense-actions">
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => {
                            setEditing(e);
                            setShowForm(true);
                          }}
                        >
                          ✎
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => deleteExpense(e)}>
                          ✕
                        </button>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {summary && (
            <SettlementView
              currency={currency}
              participants={participants}
              previewTransfers={summary.transfers}
              openCount={summary.openExpenseCount}
              settlements={data?.settlements ?? []}
              busy={settling}
              onSettle={settleNow}
              onToggleTransfer={toggleTransfer}
              onReopen={reopen}
            />
          )}

          {settledExpenses.length > 0 && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Abgerechnete Ausgaben</h3>
              <ul className="expense-list">
                {settledExpenses.map((e) => (
                  <li key={e.id} className="expense-row settled">
                    <div className="expense-main">
                      <strong>{e.title}</strong>
                      <span className="muted">
                        {nameOf(e.paidByParticipantId)} · {formatDate(e.expenseDate)}
                      </span>
                    </div>
                    <span className="expense-amount">{formatMoney(e.amountCents, currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {showForm && summary && (
        <ExpenseForm
          participants={participants}
          currency={currency}
          token={token}
          participantId={participantId}
          editing={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            reload();
          }}
        />
      )}

    </div>
  );
}
