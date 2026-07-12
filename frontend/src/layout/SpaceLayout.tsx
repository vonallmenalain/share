import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import TopBar from '../components/TopBar';
import Dropdown from '../components/Dropdown';
import UserIcon from '../components/UserIcon';
import ShareIcon from '../components/ShareIcon';
import ModuleNavigation from '../components/ModuleNavigation';
import ParticipantGate from '../components/ParticipantGate';
import ParticipantPinSetup from '../components/ParticipantPinSetup';
import ParticipantPinManager from '../components/ParticipantPinManager';
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
  const {
    slug,
    phase,
    space,
    name,
    setName,
    gate,
    enter,
    chromeHidden,
    setChromeHidden,
    visitedSpaces,
    removeVisitedSpace,
    identity,
  } = useSpaceSessionContext();
  const location = useLocation();
  // Modul-Navigation ist standardmässig eingeklappt (kein permanenter
  // Platzverbrauch) und öffnet sich nur über den Hamburger-Button oben links.
  const [navOpen, setNavOpen] = useState(false);
  const [showIdentityManager, setShowIdentityManager] = useState(false);

  // PWA-Manifest auf den aktuellen Bereich zeigen lassen (wie bisher).
  useEffect(() => {
    if (!slug || !space) return;
    setSpaceManifest(slug, space.name);
    return () => resetManifest();
  }, [slug, space]);

  // Beim Wechsel zwischen Modulen den „Vollbild"-Zustand zurücksetzen, damit
  // TopBar & Navigation auf den anderen Seiten immer sichtbar sind, und das
  // Überlagerungsmenü schliessen.
  useEffect(() => {
    setChromeHidden(false);
    setNavOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Überlagerungsmenü auch mit Escape schliessen können.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

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
    const pinHint = space?.requireParticipantPin
      ? 'Mit dem Code kannst nur du Änderungen in deinem Namen vornehmen.'
      : 'Du kannst deinen Namen mit einem Code schützen, damit nur du unter deinem Namen Änderungen vornehmen kannst.';
    return (
      <div className="center-page">
        <div className="panel">
          <span className="hero-badge">{space?.name ?? 'Bereich'}</span>
          <h1>Bereich betreten</h1>
          <p className="sub">Gib deinen Namen ein, damit alle sehen, von wem die Beiträge stammen.</p>
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
                required
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
                <p className="hint" style={{ marginTop: 6 }}>
                  Auf den Bereich kann nur mit einem Passwort des Erstellers zugegriffen werden.
                </p>
              </div>
            )}
            <div className="field">
              <label className="label">
                {space?.requireParticipantPin ? 'Code (4–8 Ziffern, Pflicht)' : 'Code (4–8 Ziffern, optional)'}
              </label>
              <input
                className="input"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                placeholder="••••"
                value={gate.pin}
                onChange={(e) => gate.setPin(e.target.value)}
                required={space?.requireParticipantPin}
              />
              <p className="hint" style={{ marginTop: 6 }}>
                {pinHint}
              </p>
            </div>
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

  // „Wer bist du?" – einmal pro Bereich und Gerät, unabhängig vom zuerst
  // geöffneten Link/Modul. Erst danach wird der eigentliche Inhalt gezeigt.
  // Während die beim Betreten erfasste Identität im Hintergrund angelegt wird
  // (identity.creating), soll diese Abfrage nicht kurz aufblitzen.
  const needsIdentity = !identity.loading && !identity.current && !identity.creating;
  // Ist der Code (PIN) in diesem Bereich Pflicht, aber die aktuelle Person
  // hat (noch) keinen – z. B. frisch angelegt ohne Code (sollte nicht
  // vorkommen) oder weil der Administrator ihn zurückgesetzt hat („Code
  // vergessen?") – muss zuerst ein neuer Code vergeben werden.
  const needsPinSetup =
    !identity.loading && !!identity.current && identity.requirePin && !identity.current.hasPin;

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
      <TopBar
        hidden={chromeHidden}
        brandTo={`/s/${slug}`}
        onMenuClick={showNav ? () => setNavOpen((o) => !o) : undefined}
        menuOpen={navOpen}
      >
        <div className="topbar-actions">
          <Dropdown
            align="end"
            ariaLabel="Bereich & Identität"
            title={identity.current?.name || name || 'Gast'}
            triggerClassName="btn icon-btn"
            label={<UserIcon size={19} />}
          >
            {(close) => (
              <>
                <div className="dropdown-label">Bereich</div>
                <div className="dropdown-current-space">
                  <span className="dropdown-space-dot" aria-hidden="true" />
                  <strong>{space?.name || slug}</strong>
                </div>
                {otherSpaces.map((s) => (
                  <div key={s.slug} className="dropdown-space-row">
                    <Link
                      to={`/s/${s.slug}`}
                      className="dropdown-item dropdown-space-link"
                      onClick={() => close()}
                      title={`Zu „${s.name}" wechseln`}
                    >
                      <span className="avatar sm" style={{ background: colorForName(s.name) }}>
                        {initialsOf(s.name)}
                      </span>
                      <span className="dropdown-item-text">{s.name}</span>
                    </Link>
                    <button
                      type="button"
                      className="dropdown-space-remove"
                      title={`„${s.name}" verlassen (aus dieser Liste entfernen)`}
                      aria-label={`„${s.name}" verlassen`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeVisitedSpace(s.slug);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
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
                {identity.current && !needsIdentity && !needsPinSetup && (
                  <>
                    <div className="dropdown-divider" />
                    <div className="dropdown-label">Deine Identität</div>
                    <div className="dropdown-name">
                      <span
                        className="avatar sm"
                        style={{ background: identity.current.color || colorForName(identity.current.name) }}
                      >
                        {initialsOf(identity.current.name)}
                      </span>
                      <strong>{identity.current.name}</strong>
                      {identity.current.hasPin && (
                        <span className="participant-choice-lock" title="Mit Code geschützt">
                          🔒
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="dropdown-item"
                      onClick={() => {
                        close();
                        setShowIdentityManager(true);
                      }}
                    >
                      Identität ändern
                    </button>
                  </>
                )}
              </>
            )}
          </Dropdown>
        </div>
      </TopBar>

      {showNav && !identity.loading && !needsIdentity && !needsPinSetup && (
        <ModuleNavigation
          slug={slug}
          modules={modules}
          hidden={chromeHidden}
          open={navOpen}
          onClose={() => setNavOpen(false)}
        />
      )}

      <div className={`space-shell${showNav ? ' has-nav' : ''}`}>
        {identity.loading || identity.creating ? (
          <div className="center-page" style={{ minHeight: 240 }}>
            <span className="spinner lg" />
          </div>
        ) : needsIdentity ? (
          <div className="container module-page">
            {identity.createError && (
              <div className="error-box" style={{ maxWidth: 480, margin: '0 auto 12px' }}>
                {identity.createError}
              </div>
            )}
            <ParticipantGate
              participants={identity.participants}
              prefillName={name}
              requirePin={identity.requirePin}
              onSelect={identity.select}
              onCreate={identity.create}
              onVerifyPin={identity.verifyPin}
            />
          </div>
        ) : needsPinSetup && identity.current ? (
          <div className="container module-page">
            <ParticipantPinSetup
              participant={identity.current}
              onSetPin={(opts) => identity.setPin(identity.current!.id, opts)}
            />
          </div>
        ) : (
          <Outlet />
        )}
      </div>

      {showIdentityManager && identity.current && (
        <ParticipantPinManager
          participant={identity.current}
          onSetPin={(opts) => identity.setPin(identity.current!.id, opts)}
          onClose={() => setShowIdentityManager(false)}
          onSwitchIdentity={() => {
            setShowIdentityManager(false);
            identity.switchIdentity();
          }}
        />
      )}
    </>
  );
}
