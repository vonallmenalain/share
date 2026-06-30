import { useState } from 'react';
import { Link } from 'react-router-dom';
import TopBar from '../components/TopBar';
import { api, Space } from '../api/client';
import { adminKeyStore } from '../lib/storage';

export default function CreateSpace() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [adminKey, setAdminKey] = useState(adminKeyStore.get());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Space | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl = created ? `${window.location.origin}/s/${created.slug}` : '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api<{ space: Space }>('/api/spaces', {
        method: 'POST',
        adminKey,
        body: { name, password: password || undefined },
      });
      adminKeyStore.set(adminKey);
      setCreated(res.space);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Erstellen.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <TopBar>
        <Link className="btn btn-sm" to="/admin">
          Übersicht
        </Link>
      </TopBar>
      <div className="center-page">
        <div className="panel">
          {!created ? (
            <>
              <h1>Neuen Bereich erstellen</h1>
              <p className="sub">
                Lege einen privaten Bereich an. Den Link kannst du danach mit deiner Gruppe teilen.
              </p>
              {error && <div className="error-box">{error}</div>}
              <form onSubmit={submit}>
                <div className="field">
                  <label className="label">Name des Bereichs</label>
                  <input
                    className="input"
                    placeholder="z. B. Ferien Tessin"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label className="label">Passwort (optional)</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="leer lassen = ohne Passwort"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <p className="hint" style={{ marginTop: 6 }}>
                    Mit Passwort kommen nur Personen rein, die es zusätzlich zum Link kennen.
                  </p>
                </div>
                <div className="field">
                  <label className="label">Admin-Schlüssel</label>
                  <input
                    className="input"
                    type="password"
                    placeholder="ADMIN_KEY aus dem Backend"
                    value={adminKey}
                    onChange={(e) => setAdminKey(e.target.value)}
                    required
                  />
                </div>
                <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
                  {busy ? 'Erstelle…' : 'Bereich erstellen'}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1>Bereich bereit 🎉</h1>
              <p className="sub">
                „{created.name}“ wurde erstellt. Teile diesen Link mit deiner Gruppe:
              </p>
              <div className="ok-box">{shareUrl}</div>
              {created.hasPassword && (
                <p className="hint" style={{ marginBottom: 16 }}>
                  Dieser Bereich ist passwortgeschützt – gib das Passwort separat weiter.
                </p>
              )}
              <div className="row wrap">
                <button className="btn btn-primary" onClick={copy}>
                  {copied ? 'Kopiert ✓' : 'Link kopieren'}
                </button>
                <Link className="btn" to={`/s/${created.slug}`}>
                  Bereich öffnen
                </Link>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setCreated(null);
                    setName('');
                    setPassword('');
                  }}
                >
                  Weiteren erstellen
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
