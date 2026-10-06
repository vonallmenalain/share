import { Navigate, useLocation } from 'react-router-dom';
import { ModuleKey } from '../api/client';
import { useSpaceSessionContext } from '../context/SpaceSessionContext';
import { isDocumentsOnly } from '../lib/spaceLinks';
import Space from './Space';

/** Pfad (relativ zum Bereich) des jeweiligen Moduls – leer = Galerie (index). */
const MODULE_PATH: Partial<Record<ModuleKey, string>> = {
  documents: 'docs',
  finance: 'finance',
  shopping: 'shopping',
  notes: 'notes',
  calendar: 'calendar',
};

/**
 * Startseite eines Bereichs (Route-Index von `/s/:slug`). Ist die Galerie
 * (Fotos & Videos) aktiv, wird sie wie bisher direkt angezeigt. Ist sie für
 * diesen Bereich abgewählt (z. B. ein reiner Finanz-Bereich), wird stattdessen
 * zum ersten aktivierten Modul weitergeleitet, damit der Bereich beim Öffnen
 * nicht auf einer nicht existierenden Galerie landet. Reine Dokumente-Bereiche
 * landen auf ihrem schlanken Ansichtslink `/d/<slug>`.
 */
export default function SpaceIndex() {
  const { slug, space } = useSpaceSessionContext();
  const location = useLocation();
  const modules = space?.modules ?? ['photos'];

  if (modules.includes('photos') || modules.length === 0) {
    return <Space />;
  }

  if (isDocumentsOnly(modules)) {
    return <Navigate to={`/d/${slug}${location.search}`} replace />;
  }

  const path = MODULE_PATH[modules[0]];
  return <Navigate to={path ? `/s/${slug}/${path}` : `/s/${slug}`} replace />;
}
