import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fileUrl, Note, NoteChecklistItem } from '../../api/client';
import { useSpaceSessionContext } from '../../context/SpaceSessionContext';
import { useModuleData } from '../../lib/useModuleData';
import { uploadNoteImage } from '../../lib/uploader';
import { nameStore } from '../../lib/storage';

export default function NoteEditorPage() {
  const { slug, token, name, identity } = useSpaceSessionContext();
  const { noteId = '' } = useParams();
  const navigate = useNavigate();
  const participantId = identity.currentId ?? undefined;

  const load = useCallback(
    async (signal: AbortSignal) => {
      const res = await api<{ note: Note }>(`/api/notes/${noteId}`, { token, signal });
      return res.note;
    },
    [token, noteId],
  );

  const { data: note, loading, reload, setData } = useModuleData<Note>(load, [token, noteId]);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [newItem, setNewItem] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Merkt sich, für welche Notiz-ID die Eingabefelder zuletzt vom Server
  // befüllt wurden.
  const loadedNoteIdRef = useRef<string | null>(null);

  // Titel/Text NUR beim ersten Laden einer Notiz aus dem Server übernehmen –
  // danach ist das Eingabefeld die alleinige Quelle der Wahrheit, bis die
  // Notiz gewechselt wird. Andernfalls würde jede automatische Zwischen-
  // speicherung (z. B. nach einer kurzen Tippause) die Eingabe erneut
  // überschreiben – etwa ein gerade erst gelöschter Titel oder ein frisch
  // eingefügter Zeilenumbruch würden plötzlich wieder auftauchen bzw.
  // verschwinden, während man noch am Schreiben ist.
  useEffect(() => {
    if (note && loadedNoteIdRef.current !== note.id) {
      setTitle(note.title);
      setBody(note.body ?? '');
      loadedNoteIdRef.current = note.id;
      dirtyRef.current = false;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    }
  }, [note]);

  const persist = useCallback(
    async (patch: { title?: string; body?: string; pinned?: boolean }) => {
      setSaving(true);
      try {
        const res = await api<{ note: Note }>(`/api/notes/${noteId}`, {
          method: 'PATCH',
          token,
          participantId,
          body: patch,
        });
        dirtyRef.current = false;
        setData(res.note);
      } catch {
        reload();
      } finally {
        setSaving(false);
      }
    },
    [noteId, token, participantId, setData, reload],
  );

  const scheduleSave = useCallback(
    (patch: { title?: string; body?: string }) => {
      dirtyRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void persist(patch), 800);
    },
    [persist],
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const flushSave = () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (dirtyRef.current) void persist({ title, body });
  };

  const togglePin = () => {
    if (!note) return;
    void persist({ pinned: !note.pinned });
  };

  const deleteNote = async () => {
    if (!confirm('Diese Notiz löschen?')) return;
    try {
      await api(`/api/notes/${noteId}`, { method: 'DELETE', token, participantId });
      navigate(`/s/${slug}/notes`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
    }
  };

  // ---- Checkliste ----------------------------------------------------------
  const addChecklistItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = newItem.trim();
    if (!text) return;
    setNewItem('');
    try {
      await api(`/api/notes/${noteId}/checklist`, {
        method: 'POST',
        token,
        participantId,
        body: { text },
      });
      reload();
    } catch {
      reload();
    }
  };

  const toggleChecklistItem = async (item: NoteChecklistItem) => {
    // Optimistisch.
    setData((prev) =>
      prev
        ? {
            ...prev,
            checklist: prev.checklist?.map((c) =>
              c.id === item.id ? { ...c, checked: !c.checked } : c,
            ),
          }
        : prev,
    );
    try {
      await api(`/api/notes/${noteId}/checklist/${item.id}`, {
        method: 'PATCH',
        token,
        participantId,
        body: { checked: !item.checked },
      });
    } catch {
      reload();
    }
  };

  const editChecklistItem = async (item: NoteChecklistItem, text: string) => {
    const t = text.trim();
    if (!t || t === item.text) return;
    try {
      await api(`/api/notes/${noteId}/checklist/${item.id}`, {
        method: 'PATCH',
        token,
        participantId,
        body: { text: t },
      });
      reload();
    } catch {
      reload();
    }
  };

  const deleteChecklistItem = async (item: NoteChecklistItem) => {
    setData((prev) =>
      prev ? { ...prev, checklist: prev.checklist?.filter((c) => c.id !== item.id) } : prev,
    );
    try {
      await api(`/api/notes/${noteId}/checklist/${item.id}`, {
        method: 'DELETE',
        token,
        participantId,
      });
    } catch {
      reload();
    }
  };

  // ---- Anhänge -------------------------------------------------------------
  const fileRef = useRef<HTMLInputElement>(null);

  const addImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const uploaderName = name.trim() || nameStore.get() || 'Unbekannt';
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        await uploadNoteImage(token, noteId, file, uploaderName);
      }
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Bild-Upload fehlgeschlagen.');
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = async (itemId: string) => {
    if (!confirm('Dieses Bild aus der Notiz entfernen?')) return;
    setData((prev) =>
      prev ? { ...prev, attachments: prev.attachments.filter((a) => a.id !== itemId) } : prev,
    );
    try {
      await api(`/api/notes/${noteId}/attachments/${itemId}`, {
        method: 'DELETE',
        token,
        participantId,
      });
    } catch {
      reload();
    }
  };

  if (loading && !note) {
    return (
      <div className="center-page" style={{ minHeight: 160 }}>
        <span className="spinner lg" />
      </div>
    );
  }

  if (!note) {
    return (
      <div className="container module-page">
        <div className="empty-hint">Notiz nicht gefunden.</div>
        <Link className="btn" to={`/s/${slug}/notes`}>
          Zurück
        </Link>
      </div>
    );
  }

  return (
    <div className="container module-page note-editor">
      <div className="module-head">
        <Link className="btn btn-sm btn-ghost" to={`/s/${slug}/notes`}>
          ← Notizen
        </Link>
        <div className="spacer" />
        <span className="muted note-save-state">{saving ? 'Speichert…' : 'Gespeichert'}</span>
        <button className="btn btn-sm" onClick={togglePin} title="Anheften">
          {note.pinned ? '📌 Angeheftet' : 'Anheften'}
        </button>
        <button className="btn btn-sm btn-danger" onClick={deleteNote}>
          Löschen
        </button>
      </div>

      <input
        className="input note-title-input"
        value={title}
        placeholder="Titel"
        onChange={(e) => {
          setTitle(e.target.value);
          scheduleSave({ title: e.target.value, body });
        }}
        onBlur={flushSave}
      />

      {note.noteType === 'text' ? (
        <textarea
          className="input note-body-input"
          value={body}
          placeholder="Text…"
          rows={10}
          onChange={(e) => {
            setBody(e.target.value);
            scheduleSave({ title, body: e.target.value });
          }}
          onBlur={flushSave}
        />
      ) : (
        <div className="note-checklist">
          {(note.checklist ?? []).map((item) => (
            <div key={item.id} className={`checklist-row${item.checked ? ' checked' : ''}`}>
              <input
                type="checkbox"
                checked={item.checked}
                onChange={() => toggleChecklistItem(item)}
              />
              <input
                className="checklist-text-input"
                defaultValue={item.text}
                onBlur={(e) => editChecklistItem(item, e.target.value)}
              />
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => deleteChecklistItem(item)}
                title="Löschen"
              >
                ✕
              </button>
            </div>
          ))}
          <form className="checklist-add" onSubmit={addChecklistItem}>
            <input
              className="input"
              placeholder="Neuer Punkt (Enter)"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
            />
            <button className="btn btn-sm btn-primary" disabled={!newItem.trim()}>
              +
            </button>
          </form>
        </div>
      )}

      <div className="note-attachments">
        <div className="note-attachments-head">
          <h3>Bilder</h3>
          <button className="btn btn-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? 'Lädt hoch…' : '+ Bild hinzufügen'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              void addImages(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        {note.attachments.length > 0 && (
          <div className="note-attachment-grid">
            {note.attachments.map((a) => (
              <div key={a.id} className="note-attachment">
                <a
                  href={fileUrl(`/files/preview/${a.id}`, token)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img src={fileUrl(`/files/thumb/${a.id}`, token)} alt={a.filename} loading="lazy" />
                </a>
                <button
                  className="note-attachment-remove"
                  onClick={() => removeAttachment(a.id)}
                  title="Entfernen"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
