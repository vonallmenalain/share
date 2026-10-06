import { useState } from 'react';
import TopBar from './TopBar';

/**
 * Anmeldung mit dem Admin-Schlüssel – vor der Übersicht aller Bereiche und vor
 * dem Anlegen eines neuen Bereichs.
 */
export default function AdminLogin({
  title = 'Admin-Login',
  sub,
  busy,
  error,
  onSubmit,
}: {
  title?: string;
  sub: string;
  busy: boolean;
  error: string;
  onSubmit: (key: string) => void;
}) {
  const [key, setKey] = useState('');
  return (
    <>
      <TopBar />
      <div className="center-page">
        <div className="panel">
          <h1>{title}</h1>
          <p className="sub">{sub}</p>
          {error && <div className="error-box">{error}</div>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (key.trim()) onSubmit(key.trim());
            }}
          >
            <div className="field">
              <input
                className="input"
                type="password"
                placeholder="Admin-Schlüssel"
                autoComplete="current-password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoFocus
              />
            </div>
            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              disabled={busy || !key.trim()}
            >
              {busy ? 'Prüfe…' : 'Anmelden'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
