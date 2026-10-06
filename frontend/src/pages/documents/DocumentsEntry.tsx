import { Navigate } from 'react-router-dom';
import { useSpaceSessionContext } from '../../context/SpaceSessionContext';
import DocumentsPage from './DocumentsPage';

/**
 * Einstieg über den Ansichtslink `/d/<slug>`: zeigt die Dokumente – oder, falls
 * der Bereich (inzwischen) kein Dokumente-Modul hat, den normalen Bereich.
 */
export default function DocumentsEntry() {
  const { slug, space } = useSpaceSessionContext();
  if (!space?.modules?.includes('documents')) return <Navigate to={`/s/${slug}`} replace />;
  return <DocumentsPage />;
}
