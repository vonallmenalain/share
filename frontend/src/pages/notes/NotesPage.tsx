import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fileUrl, Item, Note, NoteType } from '../../api/client';
import { useSpaceSessionContext } from '../../context/SpaceSessionContext';
import { useModuleData } from '../../lib/useModuleData';
import { formatDate } from '../../lib/format';
import { linkify } from '../../lib/linkify';
import Lightbox from '../../components/Lightbox';

export default function NotesPage() {
  const { slug, token, name, identity } = useSpaceSessionContext();
  const navigate = useNavigate();
  const { currentId } = identity;
  const participantId = currentId ?? undefined;
  const [creating, setCreating] = useState(false);
  // Es kann immer nur genau eine Notiz aufgeklappt sein. Klick auf eine bereits
  // aufgeklappte Notiz klappt sie wieder ein; Klick auf eine andere klappt die
  // vorherige automatisch ein.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Für die vergrösserte Bildansicht: Bilder der geöffneten Notiz und der Index
  // des aktuell angezeigten Bilds. `null` = keine Lightbox offen.
  const [lightbox, setLightbox] = useState<{ items: Item[]; index: number } | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const downloadOriginal = (item: Item) => {
    const a = document.createElement('a');
    a.href = fileUrl(`/files/original/${item.id}`, token);
    a.download = item.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

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
          {notes.map((n) => {
            const expanded = expandedId === n.id;
            return (
              <div
                key={n.id}
                className={`note-card${expanded ? ' expanded' : ''}`}
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                onClick={() => toggleExpand(n.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleExpand(n.id);
                  }
                }}
              >
                <div className="note-card-head">
                  <span className="note-type-icon">{n.noteType === 'checklist' ? '☑' : '📄'}</span>
                  <strong className="note-card-title">{n.title || 'Ohne Titel'}</strong>
                  {n.pinned && <span className="note-pin" title="Angeheftet">📌</span>}
                </div>
                {n.noteType === 'checklist' ? (
                  expanded && n.checklist && n.checklist.length > 0 ? (
                    <ul className="note-card-checklist">
                      {n.checklist.map((c) => (
                        <li key={c.id} className={c.checked ? 'checked' : ''}>
                          <span className="note-card-check">{c.checked ? '☑' : '☐'}</span>
                          <span>{linkify(c.text)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="note-card-preview muted">
                      {n.checklistCheckedCount}/{n.checklistCount} erledigt
                    </div>
                  )
                ) : (
                  n.body && (
                    <div className={`note-card-preview${expanded ? ' expanded' : ''}`}>
                      {linkify(expanded ? n.body : n.body.slice(0, 140))}
                    </div>
                  )
                )}
                {n.attachments.length > 0 && (
                  <div className="note-card-thumbs">
                    {(expanded ? n.attachments : n.attachments.slice(0, 4)).map((a, i) => (
                      <button
                        key={a.id}
                        type="button"
                        className="note-card-thumb"
                        title="Bild vergrössern"
                        onClick={(e) => {
                          // Klick auf ein Bild öffnet die vergrösserte Ansicht und
                          // darf die Karte nicht auf-/zuklappen.
                          e.stopPropagation();
                          setLightbox({ items: n.attachments, index: i });
                        }}
                      >
                        <img
                          src={fileUrl(`/files/thumb/${a.id}`, token)}
                          alt={a.filename}
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                )}
                <div className="note-card-foot muted">
                  <span>{formatDate(n.updatedAt)}</span>
                  {expanded && (
                    <button
                      className="btn btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/s/${slug}/notes/${n.id}`);
                      }}
                    >
                      Bearbeiten
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {lightbox && (
        <Lightbox
          items={lightbox.items}
          index={lightbox.index}
          token={token}
          currentName={name}
          onClose={() => setLightbox(null)}
          onNavigate={(i) => setLightbox((prev) => (prev ? { ...prev, index: i } : prev))}
          onDownload={downloadOriginal}
        />
      )}
    </div>
  );
}
