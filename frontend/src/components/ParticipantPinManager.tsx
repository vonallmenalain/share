import { useState } from 'react';
import { Participant } from '../api/client';

/**
 * „Identität ändern" – ein einziger Einstiegspunkt für alles, was mit der
 * eigenen Identität zu tun hat. Das Haupt-PopUp bietet – von oben nach unten –
 * drei Möglichkeiten an: zu einer anderen Person wechseln, den eigenen Namen
 * ändern und (erst weiter unten) einen optionalen Schutz-Code (PIN)
 * setzen/ändern. Die beiden letzten öffnen jeweils einen zweiten Schritt mit
 * den eigentlichen Feldern – so bleibt das Haupt-PopUp aufgeräumt und die
 * Erklärung zum Code erscheint erst, wenn wirklich einer gesetzt werden soll.
 *
 * Kein echtes Login – der Code ist nur ein einfacher Schutz dagegen, dass
 * jemand anderes im selben Bereich denselben Namen auswählt. Identitäten
 * zusammenzuführen/zu migrieren bleibt bewusst dem Adminbereich vorbehalten.
 */
type View = 'menu' | 'name' | 'pin';

export default function ParticipantPinManager({
  participant,
  onSetPin,
  onRename,
  onClose,
  onSwitchIdentity,
}: {
  participant: Participant;
  onSetPin: (opts: { pin: string | null; currentPin?: string }) => Promise<unknown>;
  /** Eigenen Anzeigenamen ändern. */
  onRename: (name: string) => Promise<unknown>;
  onClose: () => void;
  /** Aktuelle Auswahl aufheben, damit wieder „Wer bist du?" gefragt wird. */
  onSwitchIdentity: () => void;
}) {
  const [view, setView] = useState<View>('menu');

  // Namensänderung
  const [newName, setNewName] = useState(participant.name);
  // Schutz-Code (PIN)
  const [currentPin, setCurrentPin] = useState('');
  const [pin, setPin] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  // Zurück zum Haupt-PopUp – dabei alle Zwischenzustände der Unterschritte
  // aufräumen, damit beim erneuten Öffnen nichts „hängen bleibt".
  const back = () => {
    setView('menu');
    setError('');
    setDone('');
    setCurrentPin('');
    setPin('');
    setNewName(participant.name);
  };

  const openStep = (next: View) => {
    setError('');
    setDone('');
    setView(next);
  };

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setDone('');
    const trimmed = newName.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await onRename(trimmed);
      setDone('Name gespeichert.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  const savePin = async (e: React.FormEvent) => {
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

  const canSaveName = newName.trim().length > 0 && newName.trim() !== participant.name;
  const canSavePin = participant.hasPin ? currentPin.trim().length > 0 : pin.trim().length > 0;

  const title =
    view === 'name'
      ? 'Mein Name ändern'
      : view === 'pin'
      ? participant.hasPin
        ? 'Mein Code ändern'
        : 'Meine Identität schützen'
      : 'Identität ändern';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {view !== 'menu' && (
              <button
                type="button"
                className="btn icon-btn btn-ghost"
                onClick={back}
                aria-label="Zurück"
                style={{ marginLeft: -8 }}
              >
                ‹
              </button>
            )}
            <h2 style={{ margin: 0 }}>{title}</h2>
          </div>
          <button className="btn icon-btn btn-ghost" onClick={onClose} aria-label="Schliessen">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="dropdown-name" style={{ padding: '0 0 16px' }}>
            <strong>{participant.name}</strong>
            {participant.hasPin && (
              <span className="participant-choice-lock" title="Mit Code geschützt">
                🔒
              </span>
            )}
          </div>

          {view === 'menu' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button type="button" className="btn" style={{ width: '100%' }} onClick={onSwitchIdentity}>
                Andere Identität wählen
              </button>
              <button
                type="button"
                className="btn"
                style={{ width: '100%' }}
                onClick={() => openStep('name')}
              >
                Mein Name ändern
              </button>
              <div className="dropdown-divider" style={{ margin: '4px 2px' }} />
              <button
                type="button"
                className="btn"
                style={{ width: '100%' }}
                onClick={() => openStep('pin')}
              >
                {participant.hasPin
                  ? 'Mein Code ändern'
                  : 'Meine Identität mit einem PIN-Code schützen'}
              </button>
            </div>
          )}

          {view === 'name' && (
            <form onSubmit={saveName}>
              <p className="sub" style={{ marginTop: 0 }}>
                Dein Name wird bei deinen Beiträgen angezeigt. Eine Änderung gilt geräteweit für
                alle deine Bereiche.
              </p>
              {error && <div className="error-box">{error}</div>}
              {done && <div className="ok-box">{done}</div>}
              <div className="field">
                <label className="label">Dein Name</label>
                <input
                  className="input"
                  value={newName}
                  maxLength={60}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
              </div>
              <button
                className="btn btn-primary"
                style={{ width: '100%' }}
                disabled={busy || !canSaveName}
              >
                {busy ? 'Speichere…' : 'Name speichern'}
              </button>
            </form>
          )}

          {view === 'pin' && (
            <form onSubmit={savePin}>
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
                  {participant.hasPin
                    ? 'Neuer Code (leer lassen, um Code zu entfernen)'
                    : 'Neuer Code (4–8 Ziffern)'}
                </label>
                <input
                  className="input"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  autoFocus={!participant.hasPin}
                />
              </div>
              <button
                className="btn btn-primary"
                style={{ width: '100%' }}
                disabled={busy || !canSavePin}
              >
                {busy ? 'Speichere…' : participant.hasPin ? 'Code aktualisieren' : 'Code einrichten'}
              </button>
            </form>
          )}
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
