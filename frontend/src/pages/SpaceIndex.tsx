import { Navigate } from 'react-router-dom';
import { ModuleKey } from '../api/client';
import { useSpaceSessionContext } from '../context/SpaceSessionContext';
import Space from './Space';

/** Pfad (relativ zum Bereich) des jeweiligen Moduls – leer = Galerie (index). */
const MODULE_PATH: Partial<Record<ModuleKey, string>> = {
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
 * nicht auf einer nicht existierenden Galerie landet.
 */
export default function SpaceIndex() {
  const { slug, space } = useSpaceSessionContext();
  const modules = space?.modules ?? ['photos'];

  if (modules.includes('photos') || modules.length === 0) {
    return <Space />;
  }

  const path = MODULE_PATH[modules[0]];
  return <Navigate to={path ? `/s/${slug}/${path}` : `/s/${slug}`} replace />;
}
