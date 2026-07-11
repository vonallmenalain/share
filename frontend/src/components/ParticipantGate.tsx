import { useState } from 'react';
import { Participant } from '../api/client';
import { colorForName, initialsOf } from '../lib/avatar';

/**
 * „Wer bist du?" – Auswahl der eigenen Teilnehmer-Identität in einem Bereich.
 * Bestehende Teilnehmer können gewählt oder ein neuer angelegt werden. Der
 * Name wird mit dem bestehenden Uploader-Namen vorbelegt.
 */
export default function ParticipantGate({
  participants,
  prefillName,
  onSelect,
  onCreate,
  title = 'Wer bist du?',
  hint = 'Wähle dich aus oder lege dich neu an – so werden Ausgaben richtig zugeordnet.',
}: {
  participants: Participant[];
  prefillName?: string;
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<unknown>;
  title?: string;
  hint?: string;
}) {
  const active = participants.filter((p) => !p.archived);
  const [newName, setNewName] = useState(prefillName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      await onCreate(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Konnte nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  };

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
                onClick={() => onSelect(p.id)}
              >
                <span
                  className="avatar"
                  style={{ background: p.color || colorForName(p.name) }}
                >
                  {initialsOf(p.name)}
                </span>
                <span>{p.name}</span>
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
          {error && <div className="error-box">{error}</div>}
          <button className="btn btn-primary" disabled={busy || !newName.trim()}>
            {busy ? 'Lege an…' : 'Als neue Person starten'}
          </button>
        </form>
      </div>
    </div>
  );
}
