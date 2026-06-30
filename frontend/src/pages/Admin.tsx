import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import TopBar from '../components/TopBar';
import { api, Space } from '../api/client';
import { adminKeyStore } from '../lib/storage';
import { formatDate } from '../lib/format';

export default function Admin() {
  const [adminKey, setAdminKey] = useState(adminKeyStore.get());
  const [authed, setAuthed] = useState(false);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (key: string) => {
    setError('');
    setBusy(true);
    try {
      const res = await api<{ spaces: Space[] }>('/api/spaces', { adminKey: key });
      setSpaces(res.spaces);
      setAuthed(true);
      adminKeyStore.set(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler.');
      setAuthed(false);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (adminKey) void load(adminKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (space: Space) => {
    if (!confirm(`Bereich „${space.name}“ mit allen Medien unwiderruflich löschen?`)) return;
    try {
      await api(`/api/spaces/${space.id}`, { method: 'DELETE', adminKey });
      setSpaces((prev) => prev.filter((s) => s.id !== space.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
    }
  };

  if (!authed) {
    return (
      <>
        <TopBar />
        <div className="center-page">
          <div className="panel">
            <h1>Admin</h1>
            <p className="sub">Gib den Admin-Schlüssel ein, um alle Bereiche zu verwalten.</p>
            {error && <div className="error-box">{error}</div>}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void load(adminKey);
              }}
            >
              <div className="field">
                <input
                  className="input"
                  type="password"
                  placeholder="Admin-Schlüssel"
                  value={adminKey}
                  onChange={(e) => setAdminKey(e.target.value)}
                  autoFocus
                />
              </div>
              <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
                {busy ? 'Prüfe…' : 'Anmelden'}
              </button>
            </form>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar>
        <Link className="btn btn-sm btn-primary" to="/new">
          + Neuer Bereich
        </Link>
      </TopBar>
      <div className="container" style={{ padding: '28px 20px 60px' }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 26 }}>Bereiche</h1>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              adminKeyStore.clear();
              setAuthed(false);
              setAdminKey('');
            }}
          >
            Abmelden
          </button>
        </div>

        {spaces.length === 0 ? (
          <div className="empty">
            <div className="big">📂</div>
            Noch keine Bereiche. <Link to="/new">Jetzt einen erstellen</Link>.
          </div>
        ) : (
          <div className="list-spaces">
            {spaces.map((s) => (
              <div className="space-row" key={s.id}>
                <div className="grow">
                  <div className="nm">{s.name}</div>
                  <div className="faint" style={{ fontSize: 13 }}>
                    /s/{s.slug} · {formatDate(s.createdAt)}
                  </div>
                </div>
                <span className="tag">{s.itemCount ?? 0} Medien</span>
                {s.hasPassword && <span className="tag">🔒</span>}
                <Link className="btn btn-sm" to={`/s/${s.slug}`}>
                  Öffnen
                </Link>
                <button className="btn btn-sm btn-danger" onClick={() => remove(s)}>
                  Löschen
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
