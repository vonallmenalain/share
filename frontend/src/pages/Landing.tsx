import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import TopBar from '../components/TopBar';
import AlaeMark from '../components/AlaeMark';

/** Die Module der App, kurz als Funktionsliste für die Startseite. */
const FEATURES = [
  { icon: '🖼️', label: 'Fotos & Videos' },
  { icon: '📄', label: 'Dokumente & Musik' },
  { icon: '💰', label: 'Finanzen' },
  { icon: '🛒', label: 'Einkaufsliste' },
  { icon: '📝', label: 'Notizen' },
  { icon: '📅', label: 'Kalender' },
];

/** Extrahiert einen Slug aus einer eingegebenen URL oder direktem Slug. */
function parseSlug(input: string): string {
  const v = input.trim();
  if (!v) return '';
  const m = v.match(/\/[sd]\/([^/?#]+)/);
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
    <>
      <TopBar />
      <div className="center-page landing-page">
        <div className="panel">
          <h1>Teilen, planen, abrechnen.</h1>
          <p className="sub">
            Ein gemeinsamer Bereich für Familie und Freunde – einfach per Link geteilt, auf iPhone,
            Android und am Computer.
          </p>
          <ul className="landing-features">
            {FEATURES.map((f) => (
              <li key={f.label}>
                <span aria-hidden="true">{f.icon}</span>
                {f.label}
              </li>
            ))}
          </ul>

          <form onSubmit={open}>
            <div className="field">
              <input
                className="input"
                aria-label="Link oder Code des Bereichs"
                placeholder="Link oder Code einfügen"
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
          <div className="landing-admin">
            <p className="hint">Neuen Bereich anlegen? Wende dich an den Administrator Alä.</p>
            <Link className="btn btn-sm" to="/admin">
              Login
            </Link>
          </div>
        </div>

        <footer className="landing-footer">
          <a href="https://alae.app" target="_blank" rel="noopener">
            App von <AlaeMark className="landing-footer-mark" />
            <strong>alae.app</strong>
          </a>
        </footer>
      </div>
    </>
  );
}
