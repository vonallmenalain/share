import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing';
import CreateSpace from './pages/CreateSpace';
import Admin from './pages/Admin';
import Space from './pages/Space';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/new" element={<CreateSpace />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/s/:slug" element={<Space />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
