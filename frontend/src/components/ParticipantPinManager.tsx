import { useState } from 'react';
import { Participant } from '../api/client';
import { colorForName, initialsOf } from '../lib/avatar';

/**
 * „Identität ändern" – ein einziger Einstiegspunkt im Dropdown für alles, was
 * mit der eigenen Identität zu tun hat: den optionalen Schutz-Code (PIN)
 * setzen/ändern/entfernen, oder zu einer anderen Person wechseln. Kein echtes
 * Login – der Code ist nur ein einfacher Schutz dagegen, dass jemand anderes
 * im selben Bereich denselben Namen auswählt.
 */
export default function ParticipantPinManager({
  participant,
  onSetPin,
  onClose,
  onSwitchIdentity,
}: {
  participant: Participant;
  onSetPin: (opts: { pin: string | null; currentPin?: string }) => Promise<unknown>;
  onClose: () => void;
  /** Aktuelle Auswahl aufheben, damit wieder „Wer bist du?" gefragt wird. */
  onSwitchIdentity: () => void;
}) {
  const [currentPin, setCurrentPin] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setDone('');
    setBusy(true);
    try {
      await onSetPin({ pin: pin.trim() || null, currentPin: currentPin.trim() || undefined });
      setDone(pin.trim() ? 'Code gespeichert.' : 'Code entfernt.');
      setCurrentPin('');
      setPin('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  const canSave = participant.hasPin ? currentPin.trim().length > 0 : pin.trim().length > 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Identität ändern</h2>
          <button className="btn icon-btn btn-ghost" onClick={onClose} aria-label="Schliessen">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="dropdown-name" style={{ padding: '0 0 14px' }}>
            <span
              className="avatar sm"
              style={{ background: participant.color || colorForName(participant.name) }}
            >
              {initialsOf(participant.name)}
            </span>
            <strong>{participant.name}</strong>
            {participant.hasPin && (
              <span className="participant-choice-lock" title="Mit Code geschützt">
                🔒
              </span>
            )}
          </div>
          <form onSubmit={save}>
            <p className="sub" style={{ marginTop: 0 }}>
              Mit dem Code kannst nur du Änderungen in deinem Namen vornehmen. Auf einem anderen
              Gerät gibst du beim Auswählen deines Namens einfach denselben Code ein.
            </p>
            {error && <div className="error-box">{error}</div>}
            {done && <div className="ok-box">{done}</div>}
            {participant.hasPin && (
              <div className="field">
                <label className="label">Aktueller Code</label>
                <input
                  className="input"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value)}
                  autoFocus
                />
              </div>
            )}
            <div className="field">
              <label className="label">
                {participant.hasPin ? 'Neuer Code (leer lassen, um Code zu entfernen)' : 'Neuer Code (4–8 Ziffern)'}
              </label>
              <input
                className="input"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoFocus={!participant.hasPin}
              />
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || !canSave}>
              {busy ? 'Speichere…' : participant.hasPin ? 'Code aktualisieren' : 'Code einrichten'}
            </button>
          </form>
          <div className="dropdown-divider" style={{ margin: '18px 2px 12px' }} />
          <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
            Nicht du? Wähle eine andere Person oder lege dich neu an.
          </p>
          <button type="button" className="btn" style={{ width: '100%' }} onClick={onSwitchIdentity}>
            Andere Identität wählen
          </button>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" style={{ width: '100%' }} onClick={onClose}>
            Schliessen
          </button>
        </div>
      </div>
    </div>
  );
}
