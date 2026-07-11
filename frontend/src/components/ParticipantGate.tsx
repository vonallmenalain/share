import { useState } from 'react';
import { Participant } from '../api/client';
import { colorForName, initialsOf } from '../lib/avatar';

/**
 * „Wer bist du?" – Auswahl der eigenen Teilnehmer-Identität in einem Bereich.
 * Bestehende Teilnehmer können gewählt oder ein neuer angelegt werden. Der
 * Name wird mit dem bestehenden Uploader-Namen vorbelegt.
 *
 * Kein echtes Login: Wer eine Person mit hinterlegtem Code (PIN) auswählt,
 * muss diesen zuerst eingeben. Ohne Code gelingt die Auswahl wie bisher
 * sofort – bewusstes Vertrauensmodell für Familie & Freunde.
 */
export default function ParticipantGate({
  participants,
  prefillName,
  onSelect,
  onCreate,
  onVerifyPin,
  title = 'Wer bist du?',
  hint = 'Wähle dich aus oder lege dich neu an – so werden Ausgaben richtig zugeordnet.',
}: {
  participants: Participant[];
  prefillName?: string;
  onSelect: (id: string) => void;
  onCreate: (name: string, pin?: string) => Promise<unknown>;
  /** Prüft einen eingegebenen Code gegen den Server, bevor ausgewählt wird. */
  onVerifyPin: (id: string, pin: string) => Promise<boolean>;
  title?: string;
  hint?: string;
}) {
  const active = participants.filter((p) => !p.archived);
  const [newName, setNewName] = useState(prefillName ?? '');
  const [newPin, setNewPin] = useState('');
  const [showPinField, setShowPinField] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Code-Abfrage für eine geschützte Identität.
  const [pinTarget, setPinTarget] = useState<Participant | null>(null);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState('');
  const [verifying, setVerifying] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
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
        onSelect(pinTarget.id);
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
                placeholder="••••"
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
                <span
                  className="avatar"
                  style={{ background: p.color || colorForName(p.name) }}
                >
                  {initialsOf(p.name)}
                </span>
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
              <label className="label">Code (4–8 Ziffern, optional)</label>
              <input
                className="input"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Nur für dich, damit niemand sonst deinen Namen wählt"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
              />
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
          <button className="btn btn-primary" disabled={busy || !newName.trim()}>
            {busy ? 'Lege an…' : 'Als neue Person starten'}
          </button>
        </form>
      </div>
    </div>
  );
}
