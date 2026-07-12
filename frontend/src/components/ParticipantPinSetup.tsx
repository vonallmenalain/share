import { useState } from 'react';
import { Participant } from '../api/client';
import { colorForName, initialsOf } from '../lib/avatar';

/**
 * Erzwungene Code-Vergabe: Der Bereich verlangt einen Code (PIN) für jede
 * Identität, aber die aktuelle Person hat (noch) keinen – z. B. weil sie neu
 * ausgewählt wurde oder weil der Administrator den Code zurückgesetzt hat
 * (Funktion „Code vergessen?"). Ohne Schliessen-Möglichkeit: Erst nach dem
 * Festlegen eines Codes geht es weiter.
 */
export default function ParticipantPinSetup({
  participant,
  onSetPin,
}: {
  participant: Participant;
  onSetPin: (opts: { pin: string | null }) => Promise<unknown>;
}) {
  const [pin, setPinValue] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const p = pin.trim();
    if (!p) return;
    if (p !== confirmPin.trim()) {
      setError('Die beiden Codes stimmen nicht überein.');
      return;
    }
    setBusy(true);
    try {
      await onSetPin({ pin: p });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="participant-gate">
      <div className="panel">
        <div className="row" style={{ alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span className="avatar" style={{ background: participant.color || colorForName(participant.name) }}>
            {initialsOf(participant.name)}
          </span>
          <h2 style={{ margin: 0 }}>Code für {participant.name} festlegen</h2>
        </div>
        <p className="sub">
          In diesem Bereich ist ein Code (PIN) Pflicht. Lege jetzt deinen Code fest – du brauchst ihn
          nur, wenn du deinen Namen später auf einem weiteren Gerät wieder auswählst.
        </p>
        {error && <div className="error-box">{error}</div>}
        <form onSubmit={save}>
          <div className="field">
            <label className="label">Code (4–8 Ziffern)</label>
            <input
              className="input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="••••"
              value={pin}
              onChange={(e) => setPinValue(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <label className="label">Code wiederholen</label>
            <input
              className="input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="••••"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || !pin.trim() || !confirmPin.trim()}>
            {busy ? 'Speichere…' : 'Code speichern'}
          </button>
        </form>
      </div>
    </div>
  );
}
