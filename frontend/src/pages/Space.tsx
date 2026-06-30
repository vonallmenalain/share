import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import TopBar from '../components/TopBar';
import Tile from '../components/Tile';
import SortableGrid from '../components/SortableGrid';
import Lightbox from '../components/Lightbox';
import UploadTray from '../components/UploadTray';
import { api, ApiError, fileUrl, Item, Space as SpaceType } from '../api/client';
import { useUploads } from '../context/Uploads';
import { nameStore, tokenStore, pendingStore } from '../lib/storage';
import { colorForName, initialsOf } from '../lib/avatar';
import { dayKey, formatDayHeading } from '../lib/format';

type View = 'gallery' | 'people' | 'time';

export default function Space() {
  const { slug = '' } = useParams();
  const uploads = useUploads();

  const [phase, setPhase] = useState<'loading' | 'gate' | 'ready' | 'notfound'>('loading');
  const [space, setSpace] = useState<SpaceType | null>(null);
  const [token, setToken] = useState('');
  const [name, setName] = useState(nameStore.get());

  const [items, setItems] = useState<Item[]>([]);
  const [view, setView] = useState<View>('gallery');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const [gatePassword, setGatePassword] = useState('');
  const [gateError, setGateError] = useState('');
  const [gateBusy, setGateBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Laden / Zugang ------------------------------------------------------
  const loadItems = useCallback(
    async (tok: string) => {
      try {
        const res = await api<{ items: Item[] }>('/api/items', { token: tok });
        setItems(res.items);
      } catch {
        /* ignore transient */
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase('loading');
      const stored = tokenStore.get(slug);
      if (stored) {
        try {
          const res = await api<{ space: SpaceType }>('/api/spaces/current', { token: stored });
          if (cancelled) return;
          setSpace(res.space);
          setToken(stored);
          setPhase('ready');
          void loadItems(stored);
          return;
        } catch {
          tokenStore.clear(slug);
        }
      }
      try {
        const res = await api<{ space: SpaceType }>(`/api/spaces/by-slug/${encodeURIComponent(slug)}`);
        if (cancelled) return;
        setSpace(res.space);
        setPhase('gate');
      } catch (err) {
        if (cancelled) return;
        setPhase(err instanceof ApiError && err.status === 404 ? 'notfound' : 'gate');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, loadItems]);

  // Periodisch aktualisieren (um Uploads anderer Personen zu sehen).
  useEffect(() => {
    if (phase !== 'ready' || !token) return;
    const id = setInterval(() => void loadItems(token), 20000);
    return () => clearInterval(id);
  }, [phase, token, loadItems]);

  // Eigene Uploads sofort in die Galerie übernehmen.
  useEffect(() => {
    if (!token) return;
    return uploads.subscribe((item) => {
      setItems((prev) => {
        const idx = prev.findIndex((p) => p.id === item.id);
        if (idx >= 0) {
          const copy = prev.slice();
          copy[idx] = item;
          return copy;
        }
        return [...prev, item];
      });
    });
  }, [token, uploads]);

  const enter = async (e: React.FormEvent) => {
    e.preventDefault();
    setGateError('');
    setGateBusy(true);
    try {
      const res = await api<{ space: SpaceType; accessToken: string }>(
        `/api/spaces/by-slug/${encodeURIComponent(slug)}/access`,
        { method: 'POST', body: { password: gatePassword || undefined } },
      );
      tokenStore.set(slug, res.accessToken);
      if (name.trim()) nameStore.set(name.trim());
      setSpace(res.space);
      setToken(res.accessToken);
      setPhase('ready');
      void loadItems(res.accessToken);
    } catch (err) {
      setGateError(err instanceof Error ? err.message : 'Zugang fehlgeschlagen.');
    } finally {
      setGateBusy(false);
    }
  };

  // ---- Upload --------------------------------------------------------------
  const startUpload = useCallback(
    (files: File[]) => {
      if (!space || !token || files.length === 0) return;
      let uploaderName = name.trim() || nameStore.get();
      if (!uploaderName) {
        uploaderName = (window.prompt('Dein Name (wird bei deinen Medien angezeigt):') || '').trim();
        if (!uploaderName) return;
        setName(uploaderName);
        nameStore.set(uploaderName);
      }
      uploads.addFiles(files, { spaceId: space.id, token, uploaderName });
    },
    [space, token, name, uploads],
  );

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) startUpload(Array.from(e.target.files));
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) startUpload(Array.from(e.dataTransfer.files));
  };

  // ---- Reihenfolge ---------------------------------------------------------
  const persistOrder = useCallback(
    (ordered: Item[]) => {
      setItems(ordered);
      if (!token) return;
      api('/api/items/order', { method: 'PATCH', token, body: { order: ordered.map((i) => i.id) } }).catch(
        () => undefined,
      );
    },
    [token],
  );

  // ---- Auswahl / Download / Löschen ---------------------------------------
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const downloadOriginal = (item: Item) => {
    const a = document.createElement('a');
    a.href = fileUrl(`/files/original/${item.id}`, token);
    a.download = item.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const downloadZip = (ids?: string[]) => {
    const q = ids && ids.length ? `?ids=${ids.join(',')}` : '';
    const a = document.createElement('a');
    a.href = fileUrl(`/files/zip${q}`, token);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const deleteSelected = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`${ids.length} Medien wirklich löschen?`)) return;
    for (const id of ids) {
      try {
        await api(`/api/items/${id}`, { method: 'DELETE', token });
      } catch {
        /* ignore */
      }
    }
    setItems((prev) => prev.filter((i) => !selected.has(i.id)));
    setSelected(new Set());
    setSelectMode(false);
  };

  // ---- Abgeleitete Daten ---------------------------------------------------
  const readyItems = useMemo(() => items, [items]);

  const peopleGroups = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of readyItems) {
      const k = it.uploaderName || 'Unbekannt';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [readyItems]);

  const timeGroups = useMemo(() => {
    const sorted = [...readyItems].sort((a, b) => {
      const ta = new Date(a.takenAt || a.createdAt).getTime();
      const tb = new Date(b.takenAt || b.createdAt).getTime();
      return ta - tb;
    });
    const map = new Map<string, Item[]>();
    for (const it of sorted) {
      const k = dayKey(it.takenAt, it.createdAt);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [readyItems]);

  // Flache Liste in aktueller Anzeige-Reihenfolge (für die Lightbox-Navigation).
  const flatOrder = useMemo(() => {
    if (view === 'people') return peopleGroups.flatMap(([, arr]) => arr);
    if (view === 'time') return timeGroups.flatMap(([, arr]) => arr);
    return readyItems;
  }, [view, peopleGroups, timeGroups, readyItems]);

  const lightboxIndex = lightboxId ? flatOrder.findIndex((i) => i.id === lightboxId) : -1;

  // Unterbrochene Uploads (nach Browser-Neustart) – Hinweis.
  const stalePending = space
    ? pendingStore
        .all(space.id)
        .filter((p) => !uploads.tasks.some((t) => t.fingerprint === p.fingerprint))
    : [];

  // ---- Render --------------------------------------------------------------
  if (phase === 'loading') {
    return (
      <div className="center-page">
        <span className="spinner lg" />
      </div>
    );
  }

  if (phase === 'notfound') {
    return (
      <div className="center-page">
        <div className="panel">
          <h1>Bereich nicht gefunden</h1>
          <p className="sub">Der Link ist ungültig oder der Bereich wurde gelöscht.</p>
        </div>
      </div>
    );
  }

  if (phase === 'gate') {
    return (
      <div className="center-page">
        <div className="panel">
          <span className="hero-badge">{space?.name ?? 'Bereich'}</span>
          <h1>Bereich betreten</h1>
          <p className="sub">
            Gib deinen Namen ein, damit alle sehen, von wem die Fotos stammen
            {space?.hasPassword ? ' – und das Passwort des Bereichs.' : '.'}
          </p>
          {gateError && <div className="error-box">{gateError}</div>}
          <form onSubmit={enter}>
            <div className="field">
              <label className="label">Dein Name</label>
              <input
                className="input"
                placeholder="z. B. Anna"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            {space?.hasPassword && (
              <div className="field">
                <label className="label">Passwort</label>
                <input
                  className="input"
                  type="password"
                  value={gatePassword}
                  onChange={(e) => setGatePassword(e.target.value)}
                />
              </div>
            )}
            <button className="btn btn-primary" style={{ width: '100%' }} disabled={gateBusy}>
              {gateBusy ? 'Öffne…' : 'Bereich betreten'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <>
      <TopBar>
        <span className="muted" style={{ fontSize: 14 }}>
          als <strong>{name || 'Gast'}</strong>
        </span>
        <button
          className="btn btn-sm"
          onClick={() => {
            const n = (window.prompt('Dein Name:', name) || '').trim();
            if (n) {
              setName(n);
              nameStore.set(n);
            }
          }}
        >
          Name ändern
        </button>
      </TopBar>

      <div
        className="container"
        style={{ paddingBottom: 80 }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="space-head">
          <h1 className="space-title">{space?.name}</h1>
          <div className="space-meta">
            {readyItems.length} {readyItems.length === 1 ? 'Medium' : 'Medien'}
            {space?.hasPassword ? ' · 🔒 passwortgeschützt' : ''}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          style={{ display: 'none' }}
          onChange={onFilePick}
        />

        <div className="toolbar">
          <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
            ↑ Hochladen
          </button>

          <div className="segmented">
            <button className={view === 'gallery' ? 'active' : ''} onClick={() => setView('gallery')}>
              Galerie
            </button>
            <button className={view === 'people' ? 'active' : ''} onClick={() => setView('people')}>
              Nach Person
            </button>
            <button className={view === 'time' ? 'active' : ''} onClick={() => setView('time')}>
              Chronologisch
            </button>
          </div>

          <div className="spacer" />

          {selectMode ? (
            <>
              <span className="muted" style={{ fontSize: 14 }}>
                {selected.size} ausgewählt
              </span>
              <button
                className="btn btn-sm"
                disabled={selected.size === 0}
                onClick={() => downloadZip(Array.from(selected))}
              >
                ↓ ZIP
              </button>
              <button
                className="btn btn-sm btn-danger"
                disabled={selected.size === 0}
                onClick={deleteSelected}
              >
                Löschen
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setSelectMode(false);
                  setSelected(new Set());
                }}
              >
                Fertig
              </button>
            </>
          ) : (
            <>
              <button
                className="btn btn-sm"
                disabled={readyItems.length === 0}
                onClick={() => downloadZip()}
              >
                ↓ Alle
              </button>
              <button
                className="btn btn-sm"
                disabled={readyItems.length === 0}
                onClick={() => setSelectMode(true)}
              >
                Auswählen
              </button>
            </>
          )}
        </div>

        {view === 'gallery' && (
          <p className="hint" style={{ marginBottom: 12 }}>
            Tipp: Im Galerie-Modus kannst du die Kacheln per Drag &amp; Drop selbst anordnen.
          </p>
        )}

        {stalePending.length > 0 && (
          <div className="banner">
            <strong>Unterbrochene Uploads gefunden.</strong> Wähle dieselben Dateien noch einmal
            über „Hochladen“ aus – bereits übertragene Teile werden übersprungen, der Upload läuft
            dann weiter: {stalePending.map((p) => p.filename).join(', ')}.{' '}
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                stalePending.forEach((p) => pendingStore.remove(space!.id, p.fingerprint));
                setItems((x) => [...x]); // re-render
              }}
            >
              Verwerfen
            </button>
          </div>
        )}

        {readyItems.length === 0 ? (
          <div
            className={`dropzone${dragOver ? ' over' : ''}`}
            style={{ marginTop: 24 }}
            onClick={() => fileInputRef.current?.click()}
          >
            <div style={{ fontSize: 40, marginBottom: 8 }}>📷</div>
            <strong>Noch keine Medien</strong>
            <div className="hint" style={{ marginTop: 6 }}>
              Ziehe Fotos &amp; Videos hierher oder klicke zum Hochladen.
            </div>
          </div>
        ) : view === 'gallery' ? (
          selectMode ? (
            <div className="grid">
              {readyItems.map((item) => (
                <Tile
                  key={item.id}
                  item={item}
                  token={token}
                  selectMode
                  selected={selected.has(item.id)}
                  onToggle={() => toggleSelect(item.id)}
                  onOpen={() => setLightboxId(item.id)}
                />
              ))}
            </div>
          ) : (
            <SortableGrid
              items={readyItems}
              token={token}
              onReorder={persistOrder}
              onOpen={(item) => setLightboxId(item.id)}
            />
          )
        ) : view === 'people' ? (
          peopleGroups.map(([person, arr]) => (
            <section key={person}>
              <div className="group-heading">
                <span className="avatar" style={{ background: colorForName(person) }}>
                  {initialsOf(person)}
                </span>
                <h2>{person}</h2>
                <span className="count">{arr.length}</span>
              </div>
              <div className="grid">
                {arr.map((item) => (
                  <Tile
                    key={item.id}
                    item={item}
                    token={token}
                    selectMode={selectMode}
                    selected={selected.has(item.id)}
                    onToggle={() => toggleSelect(item.id)}
                    onOpen={() => setLightboxId(item.id)}
                  />
                ))}
              </div>
            </section>
          ))
        ) : (
          timeGroups.map(([key, arr]) => (
            <section key={key}>
              <div className="group-heading">
                <h2>{formatDayHeading(key)}</h2>
                <span className="count">{arr.length}</span>
              </div>
              <div className="grid">
                {arr.map((item) => (
                  <Tile
                    key={item.id}
                    item={item}
                    token={token}
                    selectMode={selectMode}
                    selected={selected.has(item.id)}
                    onToggle={() => toggleSelect(item.id)}
                    onOpen={() => setLightboxId(item.id)}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      {lightboxIndex >= 0 && (
        <Lightbox
          items={flatOrder}
          index={lightboxIndex}
          token={token}
          onClose={() => setLightboxId(null)}
          onNavigate={(i) => setLightboxId(flatOrder[i]?.id ?? null)}
          onDownload={downloadOriginal}
        />
      )}

      {space && <UploadTray spaceId={space.id} />}
    </>
  );
}
