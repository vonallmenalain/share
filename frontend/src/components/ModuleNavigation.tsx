import { NavLink } from 'react-router-dom';
import { ModuleKey } from '../api/client';

interface NavItem {
  key: ModuleKey;
  label: string;
  icon: string;
  /** Pfad relativ zum Bereich (ohne führenden Slash). Leer = Galerie (index). */
  path: string;
  end?: boolean;
}

const ITEMS: NavItem[] = [
  { key: 'photos', label: 'Fotos', icon: '🖼️', path: '', end: true },
  { key: 'finance', label: 'Finanzen', icon: '💰', path: 'finance' },
  { key: 'shopping', label: 'Einkauf', icon: '🛒', path: 'shopping' },
  { key: 'notes', label: 'Notizen', icon: '📝', path: 'notes' },
  { key: 'calendar', label: 'Kalender', icon: '📅', path: 'calendar' },
];

/**
 * Gemeinsame Navigation innerhalb eines Bereichs. Zeigt nur aktivierte Module.
 * Auf grösseren Bildschirmen als schmale linke Seitenleiste, auf dem Smartphone
 * als untere Navigationsleiste (per CSS). `hidden` blendet die mobile Leiste in
 * der Galerie beim Herunterscrollen aus.
 */
export default function ModuleNavigation({
  slug,
  modules,
  hidden,
}: {
  slug: string;
  modules: ModuleKey[];
  hidden?: boolean;
}) {
  const enabled = new Set<ModuleKey>(['photos', ...modules]);
  const items = ITEMS.filter((i) => enabled.has(i.key));
  // Bei nur einem Modul (reine Fotogalerie) keine Navigation anzeigen –
  // dann verhält sich die App wie bisher.
  if (items.length <= 1) return null;

  return (
    <nav className={`module-nav${hidden ? ' module-nav-hidden' : ''}`} aria-label="Bereichs-Navigation">
      {items.map((item) => {
        const to = item.path ? `/s/${slug}/${item.path}` : `/s/${slug}`;
        return (
          <NavLink
            key={item.key}
            to={to}
            end={item.end}
            className={({ isActive }) => `module-nav-item${isActive ? ' active' : ''}`}
          >
            <span className="module-nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="module-nav-label">{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
