import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import Landing from './pages/Landing';
import CreateSpace from './pages/CreateSpace';
import Admin from './pages/Admin';
import SpaceLayout from './layout/SpaceLayout';
import SpaceIndex from './pages/SpaceIndex';
import UploadPage from './pages/Upload';
import FinancePage from './pages/finance/FinancePage';
import ShoppingPage from './pages/shopping/ShoppingPage';
import NotesPage from './pages/notes/NotesPage';
import NoteEditorPage from './pages/notes/NoteEditorPage';
import CalendarPage from './pages/calendar/CalendarPage';
import DocumentsPage from './pages/documents/DocumentsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/new" element={<CreateSpace />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/s/:slug" element={<SpaceLayout />}>
        <Route index element={<SpaceIndex />} />
        <Route path="upload" element={<UploadPage />} />
        <Route path="finance" element={<FinancePage />} />
        <Route path="shopping" element={<ShoppingPage />} />
        <Route path="notes" element={<NotesPage />} />
        <Route path="notes/:noteId" element={<NoteEditorPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="docs" element={<DocumentsPage />} />
      </Route>
      <Route path="/d/:slug" element={<LegacyDocumentsLink />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * Früher geteilte Dokumente-Links (`/d/<slug>`) führen auf den Bereich selbst:
 * `/s/<slug>` zeigt reine Dokumente-Bereiche direkt als Dokumente.
 */
function LegacyDocumentsLink() {
  const { slug = '' } = useParams();
  const { search, hash } = useLocation();
  return <Navigate to={`/s/${encodeURIComponent(slug)}${search}${hash}`} replace />;
}
