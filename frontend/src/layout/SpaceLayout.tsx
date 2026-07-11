import { useEffect } from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import TopBar from '../components/TopBar';
import Dropdown from '../components/Dropdown';
import UserIcon from '../components/UserIcon';
import ShareIcon from '../components/ShareIcon';
import ModuleNavigation from '../components/ModuleNavigation';
import { setSpaceManifest, resetManifest } from '../lib/pwaManifest';
import { colorForName, initialsOf } from '../lib/avatar';
import {
  SpaceSessionProvider,
  useSpaceSessionContext,
} from '../context/SpaceSessionContext';

/** Route-Element für /s/:slug – stellt die gemeinsame Session bereit. */
export default function SpaceLayout() {
  const { slug = '' } = useParams();
  return (
    <SpaceSessionProvider slug={slug}>
      <SpaceShell />
    </SpaceSessionProvider>
  );
}

function SpaceShell() {
  const { slug, phase, space, name, setName, gate, enter, chromeHidden, setChromeHidden, visitedSpaces } =
    useSpaceSessionContext();
  const location = useLocation();

  // PWA-Manifest auf den aktuellen Bereich zeigen lassen (wie bisher).
  useEffect(() => {
    if (!slug || !space) return;
    setSpaceManifest(slug, space.name);
    return () => resetManifest();
  }, [slug, space]);

  // Beim Wechsel zwischen Modulen den „Vollbild"-Zustand zurücksetzen, damit
  // TopBar & Navigation auf den anderen Seiten immer sichtbar sind.
  useEffect(() => {
    setChromeHidden(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  if (phase === 'loading') {
    return (
      <div className="center-page">
        <span className="spinner lg" />
      </div>
    );
  }

  if (phase === 'notfound') {
    return (
      <div className="center-page">
        <div className="panel">
          <h1>Bereich nicht gefunden</h1>
          <p className="sub">Der Link ist ungültig oder der Bereich wurde gelöscht.</p>
          <Link className="btn" to="/">
            Zur Startseite
          </Link>
        </div>
      </div>
    );
  }

  if (phase === 'gate') {
    return (
      <div className="center-page">
        <div className="panel">
          <span className="hero-badge">{space?.name ?? 'Bereich'}</span>
          <h1>Bereich betreten</h1>
          <p className="sub">
            Gib deinen Namen ein, damit alle sehen, von wem die Beiträge stammen
            {space?.hasPassword ? ' – und das Passwort des Bereichs.' : '.'}
          </p>
          {gate.error && <div className="error-box">{gate.error}</div>}
          <form onSubmit={enter}>
            <div className="field">
              <label className="label">Dein Name</label>
              <input
                className="input"
                placeholder="z. B. Anna"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            {space?.hasPassword && (
              <div className="field">
                <label className="label">Passwort</label>
                <input
                  className="input"
                  type="password"
                  value={gate.password}
                  onChange={(e) => gate.setPassword(e.target.value)}
                />
              </div>
            )}
            <button className="btn btn-primary" style={{ width: '100%' }} disabled={gate.busy}>
              {gate.busy ? 'Öffne…' : 'Bereich betreten'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const modules = space?.modules ?? ['photos'];
  const showNav = modules.length > 1;
  const otherSpaces = visitedSpaces.filter((s) => s.slug !== slug);

  const changeName = () => {
    const n = (window.prompt('Dein Name:', name) || '').trim();
    if (n) setName(n);
  };

  const shareSpaceLink = async () => {
    const url = `${window.location.origin}/s/${slug}`;
    const title = space?.name || 'Bereich teilen';
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text: `Schau dir „${title}" an:`, url });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      alert('Link kopiert – jetzt kannst du ihn teilen.');
    } catch {
      window.prompt('Link zum Teilen:', url);
    }
  };

  return (
    <>
      <TopBar hidden={chromeHidden} brandTo={`/s/${slug}`}>
        <div className="topbar-actions">
          <Dropdown
            align="end"
            ariaLabel="Name & Konto"
            title={name || 'Gast'}
            triggerClassName="btn icon-btn"
            label={<UserIcon size={19} />}
          >
            {(close) => (
              <>
                <div className="dropdown-label">Aktueller Bereich</div>
                <div className="dropdown-current-space">
                  <span className="dropdown-space-dot" aria-hidden="true" />
                  <strong>{space?.name || slug}</strong>
                </div>
                {otherSpaces.length > 0 && (
                  <>
                    <div className="dropdown-label">Bereich wechseln</div>
                    {otherSpaces.map((s) => (
                      <Link
                        key={s.slug}
                        to={`/s/${s.slug}`}
                        className="dropdown-item"
                        onClick={() => close()}
                        title={`Zu „${s.name}" wechseln`}
                      >
                        <span className="avatar sm" style={{ background: colorForName(s.name) }}>
                          {initialsOf(s.name)}
                        </span>
                        <span className="dropdown-item-text">{s.name}</span>
                      </Link>
                    ))}
                  </>
                )}
                <div className="dropdown-divider" />
                <div className="dropdown-label">Dein Name</div>
                <div className="dropdown-name">
                  <span className="avatar sm" style={{ background: colorForName(name || 'Gast') }}>
                    {initialsOf(name || 'Gast')}
                  </span>
                  <strong>{name || 'Gast'}</strong>
                </div>
                <div className="dropdown-divider" />
                <button
                  type="button"
                  className="dropdown-item"
                  onClick={() => {
                    close();
                    changeName();
                  }}
                >
                  Name ändern
                </button>
                <button
                  type="button"
                  className="dropdown-item"
                  onClick={() => {
                    close();
                    void shareSpaceLink();
                  }}
                >
                  <ShareIcon size={16} />
                  Bereich teilen
                </button>
              </>
            )}
          </Dropdown>
        </div>
      </TopBar>

      {showNav && <ModuleNavigation slug={slug} modules={modules} hidden={chromeHidden} />}

      <div className={`space-shell${showNav ? ' has-nav' : ''}`}>
        <Outlet />
      </div>
    </>
  );
}
