import { Link } from 'react-router-dom';
import { ReactNode } from 'react';

export default function TopBar({
  children,
  hidden,
  brandTo = '/',
  onMenuClick,
  menuOpen,
}: {
  children?: ReactNode;
  hidden?: boolean;
  /** Ziel des "share"-Logos. In der Galerie bleibt man so im aktuellen Bereich. */
  brandTo?: string;
  /** Öffnet/schliesst die Modul-Navigation (Hamburger-Menü), falls vorhanden. */
  onMenuClick?: () => void;
  menuOpen?: boolean;
}) {
  return (
    <header className={`topbar${hidden ? ' topbar-hidden' : ''}`}>
      <div className="container topbar-inner">
        {onMenuClick && (
          <button
            type="button"
            className="btn icon-btn btn-ghost menu-btn"
            aria-label={menuOpen ? 'Menü schliessen' : 'Menü öffnen'}
            aria-expanded={menuOpen}
            onClick={onMenuClick}
          >
            <span className={`menu-btn-bars${menuOpen ? ' open' : ''}`} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
        )}
        <Link to={brandTo} className="brand">
          <span className="brand-dot" />
          share
        </Link>
        <div className="spacer" />
        {children}
      </div>
    </header>
  );
}
