import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fileUrl, Note, NoteType } from '../../api/client';
import { useSpaceSessionContext } from '../../context/SpaceSessionContext';
import { useModuleData } from '../../lib/useModuleData';
import { formatDate } from '../../lib/format';

export default function NotesPage() {
  const { slug, token, identity } = useSpaceSessionContext();
  const navigate = useNavigate();
  const { currentId } = identity;
  const participantId = currentId ?? undefined;
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    async (signal: AbortSignal) => {
      const res = await api<{ notes: Note[] }>('/api/notes', { token, signal });
      return res.notes;
    },
    [token],
  );

  const { data, loading } = useModuleData<Note[]>(load, [token], { intervalMs: 10000 });
  const notes = data ?? [];

  const createNote = async (noteType: NoteType) => {
    setCreating(true);
    try {
      // Bewusst ohne vorbelegten Titel: die Notiz startet mit einem leeren
      // Feld (Platzhalter „Titel"), das man nicht erst löschen muss.
      const res = await api<{ note: Note }>('/api/notes', {
        method: 'POST',
        token,
        participantId,
        body: { noteType },
      });
      navigate(`/s/${slug}/notes/${res.note.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Konnte nicht erstellt werden.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="container module-page">
      <div className="module-head">
        <h1 className="space-title">Notizen</h1>
        <div className="spacer" />
        <button className="btn btn-sm" disabled={creating} onClick={() => createNote('text')}>
          + Notiz
        </button>
        <button className="btn btn-sm" disabled={creating} onClick={() => createNote('checklist')}>
          + Checkliste
        </button>
      </div>

      {loading && !data ? (
        <div className="center-page" style={{ minHeight: 120 }}>
          <span className="spinner lg" />
        </div>
      ) : notes.length === 0 ? (
        <div className="empty-hint">Noch keine Notizen – lege oben eine an.</div>
      ) : (
        <div className="notes-grid">
          {notes.map((n) => (
            <button
              key={n.id}
              className="note-card"
              onClick={() => navigate(`/s/${slug}/notes/${n.id}`)}
            >
              <div className="note-card-head">
                <span className="note-type-icon">{n.noteType === 'checklist' ? '☑' : '📄'}</span>
                <strong className="note-card-title">{n.title || 'Ohne Titel'}</strong>
                {n.pinned && <span className="note-pin" title="Angeheftet">📌</span>}
              </div>
              {n.noteType === 'checklist' ? (
                <div className="note-card-preview muted">
                  {n.checklistCheckedCount}/{n.checklistCount} erledigt
                </div>
              ) : (
                n.body && <div className="note-card-preview">{n.body.slice(0, 140)}</div>
              )}
              {n.attachments.length > 0 && (
                <div className="note-card-thumbs">
                  {n.attachments.slice(0, 4).map((a) => (
                    <img
                      key={a.id}
                      src={fileUrl(`/files/thumb/${a.id}`, token)}
                      alt=""
                      loading="lazy"
                    />
                  ))}
                </div>
              )}
              <div className="note-card-foot muted">{formatDate(n.updatedAt)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
