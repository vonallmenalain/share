import { Link } from 'react-router-dom';
import { ReactNode } from 'react';

export default function TopBar({
  children,
  hidden,
}: {
  children?: ReactNode;
  hidden?: boolean;
}) {
  return (
    <header className={`topbar${hidden ? ' topbar-hidden' : ''}`}>
      <div className="container topbar-inner">
        <Link to="/" className="brand">
          <span className="brand-dot" />
          share
        </Link>
        <div className="spacer" />
        {children}
      </div>
    </header>
  );
}
