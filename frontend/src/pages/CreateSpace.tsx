import { useState } from 'react';
import { Link } from 'react-router-dom';
import TopBar from '../components/TopBar';
import { api, ModuleKey, Space } from '../api/client';
import { adminKeyStore } from '../lib/storage';

interface ModuleOption {
  key: ModuleKey;
  label: string;
  icon: string;
  desc: string;
}

const MODULE_OPTIONS: ModuleOption[] = [
  { key: 'photos', label: 'Fotos & Videos', icon: '🖼️', desc: 'Gemeinsame Galerie zum Hoch- und Herunterladen.' },
  { key: 'finance', label: 'Finanzen', icon: '💰', desc: 'Ausgaben erfassen, aufteilen und fair abrechnen.' },
  { key: 'shopping', label: 'Einkaufsliste', icon: '🛒', desc: 'Gemeinsame Liste – abhaken, was erledigt ist.' },
  { key: 'notes', label: 'Notizen', icon: '📝', desc: 'Text- und Checklisten-Notizen, auch mit Bildern.' },
  { key: 'calendar', label: 'Kalender', icon: '📅', desc: 'Termine der Gruppe an einem Ort.' },
];

const CURRENCIES = ['CHF', 'EUR', 'USD', 'GBP'];

export default function CreateSpace() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [adminKey, setAdminKey] = useState(adminKeyStore.get());
  const [modules, setModules] = useState<Set<ModuleKey>>(new Set(['photos']));
  const [currency, setCurrency] = useState('CHF');
  const [requireParticipantPin, setRequireParticipantPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Space | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl = created ? `${window.location.origin}/s/${created.slug}` : '';

  const toggleModule = (key: ModuleKey) => {
    setModules((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (modules.size === 0) {
      setError('Bitte mindestens ein Modul auswählen.');
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ space: Space }>('/api/spaces', {
        method: 'POST',
        adminKey,
        body: {
          name,
          password: password || undefined,
          modules: Array.from(modules),
          financeCurrency: modules.has('finance') ? currency : undefined,
          requireParticipantPin,
        },
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
                  <label className="label">Module</label>
                  <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
                    Wähle, was dieser Bereich enthalten soll – das lässt sich später jederzeit
                    ändern. Es muss mindestens ein Modul aktiv sein; die Galerie (Fotos &amp;
                    Videos) ist dabei kein Sonderfall mehr und kann z.&nbsp;B. für einen reinen
                    Finanz-Bereich abgewählt werden.
                  </p>
                  <div className="module-picker">
                    {MODULE_OPTIONS.map((m) => {
                      const active = modules.has(m.key);
                      return (
                        <button
                          type="button"
                          key={m.key}
                          className={`module-option${active ? ' active' : ''}`}
                          onClick={() => toggleModule(m.key)}
                          aria-pressed={active}
                        >
                          <span className="module-option-icon">{m.icon}</span>
                          <div className="module-option-text">
                            <strong>{m.label}</strong>
                            <span className="hint">{m.desc}</span>
                          </div>
                          <span className="module-option-check">{active ? '✓' : ''}</span>
                        </button>
                      );
                    })}
                  </div>
                  {modules.size === 0 && (
                    <p className="hint" style={{ marginTop: 6, color: 'var(--danger)' }}>
                      Bitte mindestens ein Modul auswählen.
                    </p>
                  )}
                </div>

                <div className="field">
                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={requireParticipantPin}
                      onChange={(e) => setRequireParticipantPin(e.target.checked)}
                    />
                    Code (PIN) für „Wer bist du?" zur Pflicht machen
                  </label>
                  <p className="hint" style={{ marginTop: 6 }}>
                    Beim ersten Öffnen dieses Bereichs wählt jede Person einmal ihren Namen (oder legt
                    sich neu an). Mit dieser Option muss dabei zusätzlich ein Code (4–8 Ziffern)
                    vergeben werden – nur so lässt sich derselbe Name später auch auf einem weiteren
                    Gerät sicher wieder verwenden. Der Code wird auf dem Gerät gespeichert und muss
                    normalerweise nur einmal eingegeben werden. Ohne diese Option bleibt der Code
                    weiterhin als freiwilliger Schutz verfügbar.
                  </p>
                </div>

                {modules.has('finance') && (
                  <div className="field">
                    <label className="label">Abrechnungswährung</label>
                    <select
                      className="input"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <p className="hint" style={{ marginTop: 6 }}>
                      Pro Bereich wird nur eine Währung verwendet – keine automatische Umrechnung.
                    </p>
                  </div>
                )}

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
                <button
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                  disabled={busy || modules.size === 0}
                >
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
