import { Navigate } from 'react-router-dom';
import { ModuleKey } from '../api/client';
import { useSpaceSessionContext } from '../context/SpaceSessionContext';
import { isDocumentsOnly } from '../lib/spaceLinks';
import Space from './Space';
import DocumentsPage from './documents/DocumentsPage';

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
 * (Fotos & Videos) aktiv, wird sie wie bisher direkt angezeigt. Reine
 * Dokumente-Bereiche zeigen ihre Dokumente direkt hier – ohne Weiterleitung,
 * damit der geteilte Link genau diese Seite öffnet. Ist die Galerie sonst
 * abgewählt (z. B. ein reiner Finanz-Bereich), wird zum ersten aktivierten
 * Modul weitergeleitet, damit der Bereich beim Öffnen nicht auf einer nicht
 * existierenden Galerie landet.
 */
export default function SpaceIndex() {
  const { slug, space } = useSpaceSessionContext();
  const modules = space?.modules ?? ['photos'];

  if (modules.includes('photos') || modules.length === 0) {
    return <Space />;
  }

  if (isDocumentsOnly(modules)) {
    return <DocumentsPage />;
  }

  const path = MODULE_PATH[modules[0]];
  return <Navigate to={path ? `/s/${slug}/${path}` : `/s/${slug}`} replace />;
}
