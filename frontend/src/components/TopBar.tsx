import { Link } from 'react-router-dom';
import { ReactNode } from 'react';

export default function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="topbar">
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
