import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CollageGrid from '../components/CollageGrid';
import Lightbox from '../components/Lightbox';
import InstallButton from '../components/InstallButton';
import ShareIcon from '../components/ShareIcon';
import Dropdown from '../components/Dropdown';
import { shareItems } from '../lib/share';
import { api, fileUrl, Item } from '../api/client';
import { useUploads } from '../context/Uploads';
import { useSpaceSessionContext } from '../context/SpaceSessionContext';
import { nameStore } from '../lib/storage';
import { colorForName, initialsOf } from '../lib/avatar';
import { dayKey, formatDayHeading } from '../lib/format';

type View = 'gallery' | 'favorites' | 'people' | 'time';

const VIEW_OPTIONS: { key: View; label: string }[] = [
  { key: 'gallery', label: 'Galerie' },
  { key: 'favorites', label: '★ Favoriten' },
  { key: 'people', label: 'Nach Uploader' },
  { key: 'time', label: 'Chronologisch' },
];

export default function Space() {
  const navigate = useNavigate();
  const uploads = useUploads();
  const { slug, space, token, name, setName, chromeHidden, setChromeHidden } =
    useSpaceSessionContext();
  const uploadHref = `/s/${slug}/upload`;
  const goUpload = useCallback(() => navigate(uploadHref), [navigate, uploadHref]);

  const [items, setItems] = useState<Item[]>([]);
  const [view, setView] = useState<View>('gallery');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [expandedPeople, setExpandedPeople] = useState<Set<string>>(new Set());
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [sharing, setSharing] = useState(false);

  // ---- Laden ---------------------------------------------------------------
  const loadItems = useCallback(async (tok: string) => {
    try {
      const res = await api<{ items: Item[] }>('/api/items', { token: tok });
      setItems(res.items);
    } catch {
      /* ignore transient */
    }
  }, []);

  useEffect(() => {
    if (token) void loadItems(token);
  }, [token, loadItems]);

  // Periodisch aktualisieren (um Uploads anderer Personen zu sehen) – nur wenn
  // das Dokument sichtbar ist.
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void loadItems(token);
    }, 20000);
    const onFocus = () => void loadItems(token);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [token, loadItems]);

  // Scroll-Richtung erkennen → TopBar & Navigation ein-/ausblenden.
  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const apply = () => {
      const y = window.scrollY;
      const delta = y - lastY;
      if (y < 90) setChromeHidden(false);
      else if (delta > 8) setChromeHidden(true);
      else if (delta < -8) setChromeHidden(false);
      lastY = y;
      ticking = false;
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(apply);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      setChromeHidden(false);
    };
  }, [setChromeHidden]);

  // Eigene Uploads sofort in die Galerie übernehmen (nur Galerie-Medien).
  useEffect(() => {
    if (!token) return;
    return uploads.subscribe((item) => {
      if (item.scope && item.scope !== 'gallery') return;
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

  // ---- Upload --------------------------------------------------------------
  const startUpload = useCallback(
    (files: File[]) => {
      if (!space || !token || files.length === 0) return;
      let uploaderName = name.trim() || nameStore.get();
      if (!uploaderName) {
        uploaderName = (window.prompt('Dein Name (wird bei deinen Medien angezeigt):') || '').trim();
        if (!uploaderName) return;
        setName(uploaderName);
      }
      uploads.addFiles(files, { spaceId: space.id, token, uploaderName });
    },
    [space, token, name, uploads, setName],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      startUpload(Array.from(e.dataTransfer.files));
      navigate(uploadHref);
    }
  };

  // ---- Auswahl / Download / Löschen ---------------------------------------
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (next.size === 0) setSelectMode(false);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const isGroupSelected = useCallback(
    (arr: Item[]) => arr.length > 0 && arr.every((i) => selected.has(i.id)),
    [selected],
  );

  const toggleGroupSelect = (arr: Item[]) => {
    if (arr.length === 0) return;
    setSelectMode(true);
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = arr.every((i) => next.has(i.id));
      for (const i of arr) {
        if (allSelected) next.delete(i.id);
        else next.add(i.id);
      }
      return next;
    });
  };

  const togglePersonExpanded = (person: string) => {
    setExpandedPeople((prev) => {
      const next = new Set(prev);
      if (next.has(person)) next.delete(person);
      else next.add(person);
      return next;
    });
  };

  const toggleDayCollapsed = (key: string) => {
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const longPressSelect = useCallback((id: string) => {
    setSelectMode(true);
    setSelected((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

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

  const shareItemsWithFallback = async (list: Item[]) => {
    if (list.length === 0 || sharing) return;
    setSharing(true);
    try {
      const outcome = await shareItems(list, token);
      if (outcome === 'unsupported') {
        if (list.length === 1) downloadOriginal(list[0]);
        else downloadZip(list.map((i) => i.id));
        alert(
          'Direktes Teilen wird von diesem Gerät bzw. Browser nicht unterstützt. ' +
            'Die Datei(en) werden stattdessen heruntergeladen – du kannst sie dann von Hand teilen.',
        );
      } else if (outcome === 'error') {
        alert('Teilen fehlgeschlagen. Bitte versuche es noch einmal.');
      }
    } finally {
      setSharing(false);
    }
  };

  const shareSelected = async () => {
    const list = readyItems.filter((i) => selected.has(i.id));
    await shareItemsWithFallback(list);
  };

  const softDeleteItems = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const ok: string[] = [];
      let failed = 0;
      for (const id of ids) {
        try {
          await api(`/api/items/${id}/delete`, {
            method: 'POST',
            token,
            uploaderName: name || undefined,
          });
          ok.push(id);
        } catch {
          failed++;
        }
      }
      setItems((prev) => prev.filter((i) => !ok.includes(i.id)));
      if (failed > 0) {
        alert(
          `${failed} ${
            failed === 1 ? 'Medium konnte' : 'Medien konnten'
          } nicht gelöscht werden. Bitte versuche es noch einmal.`,
        );
      }
    },
    [token, name],
  );

  const deleteSelected = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (
      !confirm(
        `${ids.length} ${
          ids.length === 1 ? 'Medium' : 'Medien'
        } löschen? Die Auswahl verschwindet aus der Galerie.`,
      )
    )
      return;
    await softDeleteItems(ids);
    setSelected(new Set());
    setSelectMode(false);
  };

  const deleteOne = async (item: Item) => {
    if (!confirm('Dieses Medium löschen? Es verschwindet aus der Galerie.')) return;
    await softDeleteItems([item.id]);
    setLightboxId(null);
  };

  const toggleFavorite = useCallback(
    async (item: Item) => {
      const next = !item.favorite;
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, favorite: next } : i)));
      try {
        await api(`/api/items/${item.id}/favorite`, {
          method: 'POST',
          token,
          body: { favorite: next },
          uploaderName: name || undefined,
        });
      } catch {
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, favorite: !next } : i)));
      }
    },
    [token, name],
  );

  const handleThumbUpdated = useCallback((updated: Item) => {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  }, []);

  // ---- Abgeleitete Daten ---------------------------------------------------
  const readyItems = useMemo(() => items, [items]);
  const favoriteItems = useMemo(() => readyItems.filter((i) => i.favorite), [readyItems]);

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

  const flatOrder = useMemo(() => {
    if (view === 'favorites') return favoriteItems;
    if (view === 'people') return peopleGroups.flatMap(([, arr]) => arr);
    if (view === 'time')
      return timeGroups.flatMap(([key, arr]) => (collapsedDays.has(key) ? [] : arr));
    return readyItems;
  }, [view, favoriteItems, peopleGroups, timeGroups, readyItems, collapsedDays]);

  const lightboxIndex = lightboxId ? flatOrder.findIndex((i) => i.id === lightboxId) : -1;

  const allVisibleSelected = flatOrder.length > 0 && flatOrder.every((i) => selected.has(i.id));
  const toggleSelectAllVisible = () => {
    setSelected(allVisibleSelected ? new Set() : new Set(flatOrder.map((i) => i.id)));
  };

  const spaceTasks = space ? uploads.tasks.filter((t) => t.spaceId === space.id) : [];
  const activeUploads = spaceTasks.filter((t) =>
    ['queued', 'uploading', 'processing'].includes(t.status),
  ).length;

  // ---- Render --------------------------------------------------------------
  return (
    <>
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
          <div className="space-head-line">
            <h1 className="space-title">{space?.name}</h1>
            <span className="space-count">
              {readyItems.length} {readyItems.length === 1 ? 'Medium' : 'Medien'}
              {space?.hasPassword ? ' · 🔒' : ''}
            </span>
          </div>
          <InstallButton spaceName={space?.name} />
        </div>

        <div className={`toolbar${chromeHidden ? ' toolbar-hidden' : ''}`}>
          <button className="btn btn-primary" onClick={goUpload}>
            ↑ Hochladen
          </button>

          <Dropdown
            align="start"
            ariaLabel="Ansicht wählen"
            triggerClassName="btn view-trigger"
            label={
              <>
                <span className="view-trigger-label">
                  {VIEW_OPTIONS.find((o) => o.key === view)?.label}
                </span>
                <span className="chevron" aria-hidden="true">
                  ▾
                </span>
              </>
            }
          >
            {(close) => (
              <>
                {VIEW_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={view === o.key}
                    className={`dropdown-item${view === o.key ? ' active' : ''}`}
                    onClick={() => {
                      setView(o.key);
                      close();
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </>
            )}
          </Dropdown>

          <div className="spacer" />

          {selectMode ? (
            <>
              <span className="muted" style={{ fontSize: 14 }}>
                {selected.size} ausgewählt
              </span>
              <button
                className="btn btn-sm"
                disabled={flatOrder.length === 0}
                onClick={toggleSelectAllVisible}
              >
                {allVisibleSelected ? 'Auswahl aufheben' : 'Alle auswählen'}
              </button>
              <button
                className="btn btn-sm btn-share"
                disabled={selected.size === 0 || sharing}
                onClick={() => void shareSelected()}
                title="Ausgewählte Fotos/Videos teilen"
              >
                {sharing ? <span className="spinner" /> : <ShareIcon size={15} />}
                Teilen
              </button>
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
            <button
              className="btn btn-sm select-enter-btn"
              disabled={readyItems.length === 0}
              onClick={() => setSelectMode(true)}
            >
              Auswählen
            </button>
          )}
        </div>

        {readyItems.length === 0 ? (
          <div
            className={`dropzone${dragOver ? ' over' : ''}`}
            style={{ marginTop: 24 }}
            onClick={goUpload}
          >
            <div style={{ fontSize: 40, marginBottom: 8 }}>📷</div>
            <strong>Noch keine Medien</strong>
            <div className="hint" style={{ marginTop: 6 }}>
              Ziehe Fotos &amp; Videos hierher oder klicke zum Hochladen.
            </div>
          </div>
        ) : view === 'gallery' ? (
          <CollageGrid
            items={readyItems}
            token={token}
            emphasizeFavorites
            selectMode={selectMode}
            selected={selected}
            onToggle={(item) => toggleSelect(item.id)}
            onOpen={(item) => setLightboxId(item.id)}
            onLongPress={(item) => longPressSelect(item.id)}
          />
        ) : view === 'favorites' ? (
          favoriteItems.length === 0 ? (
            <div className="dropzone" style={{ marginTop: 24, cursor: 'default' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>★</div>
              <strong>Noch keine Favoriten</strong>
              <div className="hint" style={{ marginTop: 6 }}>
                Öffne ein Foto und tippe oben rechts auf den Stern, um es als Favorit zu markieren.
              </div>
            </div>
          ) : (
            <CollageGrid
              items={favoriteItems}
              token={token}
              selectMode={selectMode}
              selected={selected}
              onToggle={(item) => toggleSelect(item.id)}
              onOpen={(item) => setLightboxId(item.id)}
              onLongPress={(item) => longPressSelect(item.id)}
            />
          )
        ) : view === 'people' ? (
          peopleGroups.map(([person, arr]) => {
            const open = expandedPeople.has(person);
            const groupSelected = isGroupSelected(arr);
            return (
              <section key={person}>
                <div className="group-heading">
                  <button
                    type="button"
                    className="group-heading-btn"
                    onClick={() => togglePersonExpanded(person)}
                    aria-expanded={open}
                  >
                    <span className="avatar" style={{ background: colorForName(person) }}>
                      {initialsOf(person)}
                    </span>
                    <h2>{person}</h2>
                    <span className="count">{arr.length}</span>
                    <span className={`chevron${open ? ' open' : ''}`}>▸</span>
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm group-select-btn${groupSelected ? ' active' : ''}`}
                    onClick={() => toggleGroupSelect(arr)}
                    title={`Alle Fotos von ${person} auswählen`}
                  >
                    {groupSelected ? 'Auswahl aufheben' : 'Alle auswählen'}
                  </button>
                </div>
                {open && (
                  <CollageGrid
                    items={arr}
                    token={token}
                    selectMode={selectMode}
                    selected={selected}
                    onToggle={(item) => toggleSelect(item.id)}
                    onOpen={(item) => setLightboxId(item.id)}
                    onLongPress={(item) => longPressSelect(item.id)}
                  />
                )}
              </section>
            );
          })
        ) : (
          timeGroups.map(([key, arr]) => {
            const groupSelected = isGroupSelected(arr);
            const open = !collapsedDays.has(key);
            return (
              <section key={key}>
                <div className="group-heading">
                  <button
                    type="button"
                    className="group-heading-btn"
                    onClick={() => toggleDayCollapsed(key)}
                    aria-expanded={open}
                    title={open ? 'Fotos dieses Tages einklappen' : 'Fotos dieses Tages ausklappen'}
                  >
                    <h2>{formatDayHeading(key)}</h2>
                    <span className="count">{arr.length}</span>
                    <span className={`chevron${open ? ' open' : ''}`}>▸</span>
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm group-select-btn${groupSelected ? ' active' : ''}`}
                    onClick={() => toggleGroupSelect(arr)}
                    title={`Alle Fotos vom ${formatDayHeading(key)} auswählen`}
                  >
                    {groupSelected ? 'Auswahl aufheben' : 'Alle auswählen'}
                  </button>
                </div>
                {open && (
                  <CollageGrid
                    items={arr}
                    token={token}
                    selectMode={selectMode}
                    selected={selected}
                    onToggle={(item) => toggleSelect(item.id)}
                    onOpen={(item) => setLightboxId(item.id)}
                    onLongPress={(item) => longPressSelect(item.id)}
                  />
                )}
              </section>
            );
          })
        )}
      </div>

      {lightboxIndex >= 0 && (
        <Lightbox
          items={flatOrder}
          index={lightboxIndex}
          token={token}
          currentName={name}
          onClose={() => setLightboxId(null)}
          onNavigate={(i) => setLightboxId(flatOrder[i]?.id ?? null)}
          onDownload={downloadOriginal}
          onShare={(item) => shareItemsWithFallback([item])}
          onDelete={deleteOne}
          onToggleFavorite={toggleFavorite}
          onThumbUpdated={handleThumbUpdated}
        />
      )}

      {dragOver && (
        <div className="drag-overlay">
          <div className="drag-overlay-inner">
            <div style={{ fontSize: 44 }}>⬆️</div>
            <strong>Zum Hochladen hier ablegen</strong>
          </div>
        </div>
      )}

      {space && activeUploads > 0 && (
        <button className="upload-fab" onClick={goUpload}>
          <span className="spinner" />
          {activeUploads} Upload{activeUploads > 1 ? 's' : ''} läuft…
        </button>
      )}
    </>
  );
}
