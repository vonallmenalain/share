import { Participant, Settlement, Transfer } from '../../api/client';
import { formatDate, formatMoney } from '../../lib/format';
import { groupLabel } from '../../lib/useParticipants';

/** Zeigt die Abrechnungsvorschau und die abgeschlossenen Abrechnungen. */
export default function SettlementView({
  currency,
  participants,
  previewTransfers,
  openCount,
  settlements,
  busy,
  onSettle,
  onToggleTransfer,
  onReopen,
}: {
  currency: string;
  participants: Participant[];
  previewTransfers: Transfer[];
  openCount: number;
  settlements: Settlement[];
  busy: boolean;
  onSettle: () => void;
  onToggleTransfer: (batchId: string, transferId: string, paid: boolean) => void;
  onReopen: (batchId: string) => void;
}) {
  const nameOf = (id: string | null | undefined) => groupLabel(participants, id);

  return (
    <div className="finance-settlements">
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Abrechnungsvorschau</h3>
        {openCount === 0 ? (
          <p className="muted">Keine offenen Ausgaben – nichts abzurechnen.</p>
        ) : previewTransfers.length === 0 ? (
          <p className="muted">Alles ausgeglichen – keine Zahlungen nötig.</p>
        ) : (
          <ul className="transfer-list">
            {previewTransfers.map((t, idx) => (
              <li key={idx} className="transfer-row">
                <span>
                  <strong>{nameOf(t.fromParticipantId)}</strong> zahlt{' '}
                  <strong>{nameOf(t.toParticipantId)}</strong>
                </span>
                <span className="transfer-amount">{formatMoney(t.amountCents, currency)}</span>
              </li>
            ))}
          </ul>
        )}
        <button
          className="btn btn-primary"
          disabled={busy || openCount === 0}
          onClick={onSettle}
          style={{ marginTop: 8 }}
        >
          {busy ? 'Rechne ab…' : 'Abrechnung abschliessen'}
        </button>
      </div>

      {settlements.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Abgeschlossene Abrechnungen</h3>
          {settlements.map((s) => (
            <div key={s.id} className={`settlement-batch${s.reopenedAt ? ' reopened' : ''}`}>
              <div className="settlement-batch-head">
                <span className="muted">
                  {formatDate(s.createdAt)}
                  {s.reopenedAt ? ' · wieder geöffnet' : ''}
                </span>
                {!s.reopenedAt && (
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      if (
                        confirm(
                          'Diese Abrechnung wieder öffnen? Die zugeordneten Ausgaben werden erneut offen.',
                        )
                      )
                        onReopen(s.id);
                    }}
                  >
                    Wieder öffnen
                  </button>
                )}
              </div>
              {s.transfers.length === 0 ? (
                <p className="muted">Keine Zahlungen (bereits ausgeglichen).</p>
              ) : (
                <ul className="transfer-list">
                  {s.transfers.map((t) => (
                    <li key={t.id} className={`transfer-row${t.paidAt ? ' paid' : ''}`}>
                      <label className="transfer-check">
                        <input
                          type="checkbox"
                          checked={!!t.paidAt}
                          disabled={!!s.reopenedAt}
                          onChange={() => onToggleTransfer(s.id, t.id, !t.paidAt)}
                        />
                        <span>
                          <strong>{nameOf(t.fromParticipantId)}</strong> →{' '}
                          <strong>{nameOf(t.toParticipantId)}</strong>
                        </span>
                      </label>
                      <span className="transfer-amount">{formatMoney(t.amountCents, currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
