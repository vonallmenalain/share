import { Link } from 'react-router-dom';
import { ReactNode } from 'react';

export default function TopBar({
  children,
  hidden,
  brandTo = '/',
}: {
  children?: ReactNode;
  hidden?: boolean;
  /** Ziel des "share"-Logos. In der Galerie bleibt man so im aktuellen Bereich. */
  brandTo?: string;
}) {
  return (
    <header className={`topbar${hidden ? ' topbar-hidden' : ''}`}>
      <div className="container topbar-inner">
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
