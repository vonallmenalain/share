import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import TopBar from '../components/TopBar';
import AdminLogin from '../components/AdminLogin';
import { api, ApiError, ModuleKey, Space } from '../api/client';
import { adminKeyStore } from '../lib/storage';
import { isDocumentsOnly, spacePath, spaceShareUrl } from '../lib/spaceLinks';

interface ModuleOption {
  key: ModuleKey;
  label: string;
  icon: string;
  desc: string;
}

const MODULE_OPTIONS: ModuleOption[] = [
  { key: 'photos', label: 'Fotos & Videos', icon: '🖼️', desc: 'Gemeinsame Galerie zum Hoch- und Herunterladen.' },
  {
    key: 'documents',
    label: 'Dokumente',
    icon: '📄',
    desc: 'PDFs, Musik & andere Dateien – direkt ansehen und anhören.',
  },
  { key: 'finance', label: 'Finanzen', icon: '💰', desc: 'Ausgaben erfassen, aufteilen und fair abrechnen.' },
  { key: 'shopping', label: 'Einkaufsliste', icon: '🛒', desc: 'Gemeinsame Liste – abhaken, was erledigt ist.' },
  { key: 'notes', label: 'Notizen', icon: '📝', desc: 'Text- und Checklisten-Notizen, auch mit Bildern.' },
  { key: 'calendar', label: 'Kalender', icon: '📅', desc: 'Termine der Gruppe an einem Ort.' },
];

const CURRENCIES = ['CHF', 'EUR', 'USD', 'GBP'];

export default function CreateSpace() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  // Neue Bereiche legt nur der Administrator an: Das Formular erscheint erst
  // nach der Anmeldung mit dem Admin-Schlüssel (ein gespeicherter wird geprüft).
  const [adminKey, setAdminKey] = useState('');
  const [auth, setAuth] = useState<'checking' | 'login' | 'ok'>(() =>
    adminKeyStore.get() ? 'checking' : 'login',
  );
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [modules, setModules] = useState<Set<ModuleKey>>(new Set(['photos']));
  const [currency, setCurrency] = useState('CHF');
  const [requireParticipantPin, setRequireParticipantPin] = useState(false);
  // „Nicht nach einem Namen fragen": schliesst den Pflicht-Code aus – ohne
  // Identität gibt es nichts, was ein Code schützen könnte.
  const [skipIdentityPrompt, setSkipIdentityPrompt] = useState(false);
  // Upload-Sperre: nur ich (Admin) darf Dateien hochladen – für alle anderen
  // ein reiner Ansichtslink.
  const [uploadsLocked, setUploadsLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Space | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl = created ? spaceShareUrl(created.slug) : '';

  const verify = async (key: string, stored: boolean) => {
    setAuthBusy(true);
    setAuthError('');
    try {
      await api('/api/spaces/admin-check', { adminKey: key });
      adminKeyStore.set(key);
      setAdminKey(key);
      setAuth('ok');
    } catch (err) {
      const rejected = err instanceof ApiError && err.status === 401;
      if (rejected) adminKeyStore.clear();
      // Ein nicht mehr gültiger gespeicherter Schlüssel: einfach neu anmelden.
      if (!(rejected && stored)) {
        setAuthError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen.');
      }
      setAuth('login');
    } finally {
      setAuthBusy(false);
    }
  };

  useEffect(() => {
    const stored = adminKeyStore.get();
    if (stored) void verify(stored, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          requireParticipantPin: skipIdentityPrompt ? false : requireParticipantPin,
          skipIdentityPrompt,
          uploadsLocked,
        },
      });
      setCreated(res.space);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        adminKeyStore.clear();
        setAuthError(err.message);
        setAuth('login');
        return;
      }
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

  if (auth === 'checking') {
    return (
      <>
        <TopBar />
        <div className="center-page">
          <span className="spinner lg" />
        </div>
      </>
    );
  }

  if (auth === 'login') {
    return (
      <AdminLogin
        title="Neuen Bereich erstellen"
        sub="Neue Bereiche legt nur der Administrator an. Bitte melde dich mit dem Admin-Schlüssel an."
        busy={authBusy}
        error={authError}
        onSubmit={(key) => void verify(key, false)}
      />
    );
  }

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
                      disabled={skipIdentityPrompt}
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
                    {skipIdentityPrompt && (
                      <>
                        {' '}
                        <strong>
                          Nicht verfügbar, solange gar nicht nach einem Namen gefragt wird.
                        </strong>
                      </>
                    )}
                  </p>
                </div>

                <div className="field">
                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={skipIdentityPrompt}
                      onChange={(e) => {
                        setSkipIdentityPrompt(e.target.checked);
                        // Ohne Identität gibt es keinen Code, der Pflicht sein
                        // könnte – die andere Option wird deshalb abgewählt.
                        if (e.target.checked) setRequireParticipantPin(false);
                      }}
                    />
                    Nicht nach einem Namen fragen
                  </label>
                  <p className="hint" style={{ marginTop: 6 }}>
                    Wer den Link anklickt, landet sofort im Bereich – z.&nbsp;B. direkt auf der
                    Fotoseite, ohne den Bildschirm „Wer bist du?" und ohne Namensfeld. Es wird dabei
                    niemand angelegt: Beiträge erscheinen unter dem Namen, den das Gerät bereits
                    kennt, sonst als „Gast". Ein Passwort (falls gesetzt) wird weiterhin abgefragt.
                    Praktisch für Bereiche zum reinen Anschauen oder für Personen, die möglichst
                    wenig gefragt werden sollen.
                  </p>
                </div>

                <div className="field">
                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={uploadsLocked}
                      onChange={(e) => setUploadsLocked(e.target.checked)}
                    />
                    Nur ich (Admin) darf Dateien hochladen
                  </label>
                  <p className="hint" style={{ marginTop: 6 }}>
                    Für alle anderen ist der Link dann ein reiner Ansichtslink: Fotos, Videos und
                    Dokumente lassen sich ansehen, abspielen und herunterladen – aber nicht
                    hochladen, löschen oder ändern. Du selbst siehst die Werkzeuge weiterhin auf
                    diesem Gerät (erkannt am gespeicherten Admin-Schlüssel).
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
                <Link className="btn" to={spacePath(created.slug)}>
                  {isDocumentsOnly(created.modules) ? 'Öffnen & Dateien hochladen' : 'Bereich öffnen'}
                </Link>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setCreated(null);
                    setName('');
                    setPassword('');
                    setUploadsLocked(false);
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
