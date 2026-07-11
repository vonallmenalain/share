import { useState } from 'react';
import { Participant } from '../api/client';

/**
 * Verwaltet den optionalen Schutz-Code (PIN) der eigenen Identität: setzen,
 * ändern oder wieder entfernen. Kein echtes Login – nur ein einfacher Schutz
 * dagegen, dass jemand anderes im selben Bereich denselben Namen auswählt.
 */
export default function ParticipantPinManager({
  participant,
  onSetPin,
  onClose,
}: {
  participant: Participant;
  onSetPin: (opts: { pin: string | null; currentPin?: string }) => Promise<unknown>;
  onClose: () => void;
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
          <h2>Code für „{participant.name}"</h2>
          <button className="btn icon-btn btn-ghost" onClick={onClose} aria-label="Schliessen">
            ✕
          </button>
        </div>
        <form onSubmit={save} className="modal-body">
          <p className="sub" style={{ marginTop: 0 }}>
            Kein echtes Login – aber solange dieser Code gesetzt ist, kann niemand sonst im Bereich deinen
            Namen auswählen und in deinem Namen etwas erfassen. Auf einem anderen Gerät gibst du beim
            Auswählen deines Namens einfach denselben Code ein.
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
          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Schliessen
            </button>
            <button className="btn btn-primary" disabled={busy || !canSave}>
              {busy ? 'Speichere…' : 'Speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
