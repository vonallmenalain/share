import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

/** Extrahiert einen Slug aus einer eingegebenen URL oder direktem Slug. */
function parseSlug(input: string): string {
  const v = input.trim();
  if (!v) return '';
  const m = v.match(/\/s\/([^/?#]+)/);
  if (m) return m[1];
  return v.replace(/^\/+|\/+$/g, '');
}

export default function Landing() {
  const [value, setValue] = useState('');
  const navigate = useNavigate();

  const open = (e: React.FormEvent) => {
    e.preventDefault();
    const slug = parseSlug(value);
    if (slug) navigate(`/s/${encodeURIComponent(slug)}`);
  };

  return (
    <div className="center-page">
      <div className="panel">
        <span className="hero-badge">Fotos &amp; Videos · privat geteilt</span>
        <h1>Eure Erinnerungen, an einem Ort.</h1>
        <p className="sub">
          Erstellt einen privaten Bereich (z.&nbsp;B. „Ferien Tessin“), teilt den Link mit der
          Familie und ladet eure Original-Fotos und -Videos hoch – von iPhone und Android. Schöne
          Galerie, einfache Up- &amp; Downloads.
        </p>

        <form onSubmit={open}>
          <div className="field">
            <label className="label">Bereich öffnen</label>
            <input
              className="input"
              placeholder="Link oder Code einfügen, z. B. ferien-tessin-k3p9x2qa"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} type="submit">
            Bereich öffnen
          </button>
        </form>

        <div className="divider" />
        <p className="hint">
          Neuen Bereich anlegen?{' '}
          <Link to="/new">Hier erstellen</Link> (Admin-Schlüssel nötig). Übersicht aller Bereiche:{' '}
          <Link to="/admin">Admin</Link>.
        </p>
      </div>
    </div>
  );
}
