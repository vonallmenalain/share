import { useState } from 'react';
import { Participant } from '../api/client';

/**
 * „Wer bist du?" – Auswahl der eigenen Identität für den gesamten Bereich.
 * Erscheint einmal pro Gerät, sobald ein beliebiger Link des Bereichs zum
 * ersten Mal geöffnet wird (siehe SpaceLayout). Bestehende Identitäten können
 * gewählt oder eine neue kann angelegt werden. Der Name wird mit dem
 * bestehenden Anzeigenamen vorbelegt.
 *
 * Kein echtes Login: Wer eine Person mit hinterlegtem Code (PIN) auswählt,
 * muss diesen zuerst eingeben. Ohne Code gelingt die Auswahl wie bisher
 * sofort – bewusstes Vertrauensmodell für Familie & Freunde. Ist der Code für
 * diesen Bereich Pflicht (requirePin), muss beim Anlegen einer neuen
 * Identität zwingend einer vergeben werden.
 */
export default function ParticipantGate({
  participants,
  prefillName,
  requirePin = false,
  onSelect,
  onCreate,
  onVerifyPin,
  title = 'Wer bist du?',
  hint = 'Wähle dich aus oder lege dich neu an – so werden Beiträge richtig zugeordnet.',
}: {
  participants: Participant[];
  prefillName?: string;
  /** Ist ein Code in diesem Bereich Pflicht? Erzwingt das PIN-Feld beim Anlegen. */
  requirePin?: boolean;
  onSelect: (id: string, pin?: string) => void;
  onCreate: (name: string, pin?: string) => Promise<unknown>;
  /** Prüft einen eingegebenen Code gegen den Server, bevor ausgewählt wird. */
  onVerifyPin: (id: string, pin: string) => Promise<boolean>;
  title?: string;
  hint?: string;
}) {
  const active = participants.filter((p) => !p.archived);
  const [newName, setNewName] = useState(prefillName ?? '');
  const [newPin, setNewPin] = useState('');
  const [showPinField, setShowPinField] = useState(requirePin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Code-Abfrage für eine geschützte Identität.
  const [pinTarget, setPinTarget] = useState<Participant | null>(null);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (requirePin && !newPin.trim()) {
      setError('In diesem Bereich ist ein Code (PIN) Pflicht – bitte einen vergeben.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onCreate(name, newPin.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Konnte nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  };

  const choose = (p: Participant) => {
    if (!p.hasPin) {
      onSelect(p.id);
      return;
    }
    setPinTarget(p);
    setPinValue('');
    setPinError('');
    setShowForgot(false);
  };

  const confirmPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinTarget) return;
    const pin = pinValue.trim();
    if (!pin) return;
    setVerifying(true);
    setPinError('');
    try {
      const ok = await onVerifyPin(pinTarget.id, pin);
      if (ok) {
        onSelect(pinTarget.id, pin);
        setPinTarget(null);
      } else {
        setPinError('Falscher Code. Bitte erneut versuchen.');
      }
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Code konnte nicht geprüft werden.');
    } finally {
      setVerifying(false);
    }
  };

  if (pinTarget) {
    return (
      <div className="participant-gate">
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Code für {pinTarget.name}</h2>
          <p className="sub">
            <strong>{pinTarget.name}</strong> hat den eigenen Namen mit einem Code geschützt, damit niemand
            sonst darunter Dinge erfasst. Bitte den Code eingeben.
          </p>
          {pinError && <div className="error-box">{pinError}</div>}
          <form onSubmit={confirmPin}>
            <div className="field">
              <label className="label">Code</label>
              <input
                className="input"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pinValue}
                onChange={(e) => setPinValue(e.target.value)}
                autoFocus
              />
            </div>
            <div className="form-row">
              <button
                type="button"
                className="btn"
                style={{ flex: 1 }}
                onClick={() => setPinTarget(null)}
              >
                Zurück
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={verifying || !pinValue.trim()}>
                {verifying ? 'Prüfe…' : 'Bestätigen'}
              </button>
            </div>
          </form>
          {!showForgot ? (
            <button
              type="button"
              className="link-btn"
              style={{ marginTop: 14, display: 'inline-block' }}
              onClick={() => setShowForgot(true)}
            >
              Code vergessen?
            </button>
          ) : (
            <p className="hint" style={{ marginTop: 14 }}>
              Bitte wende dich an die Administratorin oder den Administrator dieses Bereichs. Sie/Er
              kann deinen Code im Adminbereich zurücksetzen – danach kannst du beim Auswählen deines
              Namens sofort einen neuen Code festlegen.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="participant-gate">
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>{title}</h2>
        <p className="sub">{hint}</p>
        {active.length > 0 && (
          <div className="participant-choices">
            {active.map((p) => (
              <button
                key={p.id}
                type="button"
                className="participant-choice"
                onClick={() => choose(p)}
              >
                <span>{p.name}</span>
                {p.hasPin && <span className="participant-choice-lock" title="Mit Code geschützt">🔒</span>}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={create} className="participant-create">
          <div className="field" style={{ marginBottom: 8 }}>
            <label className="label">Neu: Dein Name</label>
            <input
              className="input"
              placeholder="z. B. Alain"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          {showPinField ? (
            <div className="field" style={{ marginBottom: 8 }}>
              <label className="label">
                {requirePin ? 'Code (4–8 Ziffern, Pflicht)' : 'Code (4–8 Ziffern, optional)'}
              </label>
              <input
                className="input"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Nur für dich, damit niemand sonst deinen Namen wählt"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                required={requirePin}
              />
              {requirePin ? (
                <p className="hint" style={{ marginTop: 6 }}>
                  Mit dem Code kannst nur du Änderungen in deinem Namen vornehmen. Solltest du ihn
                  einmal vergessen, kann er im Adminbereich zurückgesetzt werden.
                </p>
              ) : (
                <p className="hint" style={{ marginTop: 6 }}>
                  Du kannst deinen Namen mit einem Code schützen, damit nur du unter deinem Namen
                  Änderungen vornehmen kannst.
                </p>
              )}
              {!requirePin && (
                <button
                  type="button"
                  className="link-btn"
                  style={{ marginTop: 6, display: 'inline-block' }}
                  onClick={() => {
                    setShowPinField(false);
                    setNewPin('');
                  }}
                >
                  Ohne Code anlegen
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="link-btn"
              style={{ marginBottom: 16, display: 'inline-block' }}
              onClick={() => setShowPinField(true)}
            >
              + Meinen Namen mit einem Code schützen
            </button>
          )}
          {error && <div className="error-box">{error}</div>}
          <button
            className="btn btn-primary"
            disabled={busy || !newName.trim() || (requirePin && !newPin.trim())}
          >
            {busy ? 'Lege an…' : 'Als neue Person starten'}
          </button>
        </form>
      </div>
    </div>
  );
}
