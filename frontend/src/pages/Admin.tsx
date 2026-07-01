import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import TopBar from '../components/TopBar';
import { api, fileUrl, Item, ItemState, Space } from '../api/client';
import { adminKeyStore } from '../lib/storage';
import { formatBytes, formatDate, formatDuration } from '../lib/format';

interface SpaceDetail {
  status: 'loading' | 'ready' | 'error';
  token?: string;
  items?: Item[];
  error?: string;
}

const STATE_LABEL: Record<ItemState, string> = {
  active: 'Aktiv',
  archived: 'Archiviert',
  deleted: 'Gelöscht',
};

export default function Admin() {
  const [adminKey, setAdminKey] = useState(adminKeyStore.get());
  const [authed, setAuthed] = useState(false);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, SpaceDetail>>({});

  const load = async (key: string) => {
    setError('');
    setBusy(true);
    try {
      const res = await api<{ spaces: Space[] }>('/api/spaces', { adminKey: key });
      setSpaces(res.spaces);
      setAuthed(true);
      adminKeyStore.set(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler.');
      setAuthed(false);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (adminKey) void load(adminKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDetail = async (spaceId: string) => {
    setDetails((prev) => ({ ...prev, [spaceId]: { status: 'loading' } }));
    try {
      const res = await api<{ token: string; items: Item[] }>(
        `/api/spaces/${spaceId}/items`,
        { adminKey },
      );
      setDetails((prev) => ({
        ...prev,
        [spaceId]: { status: 'ready', token: res.token, items: res.items },
      }));
    } catch (err) {
      setDetails((prev) => ({
        ...prev,
        [spaceId]: {
          status: 'error',
          error: err instanceof Error ? err.message : 'Laden fehlgeschlagen.',
        },
      }));
    }
  };

  const toggle = (spaceId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(spaceId)) {
        next.delete(spaceId);
      } else {
        next.add(spaceId);
        if (!details[spaceId] || details[spaceId].status === 'error') void loadDetail(spaceId);
      }
      return next;
    });
  };

  const removeSpace = async (space: Space) => {
    if (!confirm(`Bereich „${space.name}“ mit allen Medien unwiderruflich löschen?`)) return;
    try {
      await api(`/api/spaces/${space.id}`, { method: 'DELETE', adminKey });
      setSpaces((prev) => prev.filter((s) => s.id !== space.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
    }
  };

  const setItemState = async (spaceId: string, item: Item, state: ItemState) => {
    try {
      const res = await api<{ item: Item }>(`/api/spaces/${spaceId}/items/${item.id}/state`, {
        method: 'PATCH',
        adminKey,
        body: { state },
      });
      setDetails((prev) => {
        const d = prev[spaceId];
        if (!d?.items) return prev;
        return {
          ...prev,
          [spaceId]: { ...d, items: d.items.map((i) => (i.id === item.id ? res.item : i)) },
        };
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Aktion fehlgeschlagen.');
    }
  };

  const permanentDelete = async (spaceId: string, item: Item) => {
    if (!confirm(`„${item.filename}“ endgültig und unwiderruflich löschen?`)) return;
    try {
      await api(`/api/spaces/${spaceId}/items/${item.id}`, { method: 'DELETE', adminKey });
      setDetails((prev) => {
        const d = prev[spaceId];
        if (!d?.items) return prev;
        return { ...prev, [spaceId]: { ...d, items: d.items.filter((i) => i.id !== item.id) } };
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
    }
  };

  // Sammelaktion: Zustand mehrerer Medien setzen (wiederherstellen/archivieren).
  const bulkSetState = async (spaceId: string, ids: string[], state: ItemState) => {
    if (ids.length === 0) return;
    const updated: Item[] = [];
    for (const id of ids) {
      try {
        const res = await api<{ item: Item }>(`/api/spaces/${spaceId}/items/${id}/state`, {
          method: 'PATCH',
          adminKey,
          body: { state },
        });
        updated.push(res.item);
      } catch {
        /* einzelne Fehler ignorieren, Rest weiterverarbeiten */
      }
    }
    const map = new Map(updated.map((i) => [i.id, i]));
    setDetails((prev) => {
      const d = prev[spaceId];
      if (!d?.items) return prev;
      return {
        ...prev,
        [spaceId]: { ...d, items: d.items.map((i) => map.get(i.id) ?? i) },
      };
    });
  };

  // Sammelaktion: mehrere Medien endgültig löschen (unwiderruflich).
  const bulkPermanentDelete = async (spaceId: string, ids: string[]) => {
    if (ids.length === 0) return;
    if (
      !confirm(
        `${ids.length} ${
          ids.length === 1 ? 'Medium' : 'Medien'
        } endgültig und unwiderruflich löschen?`,
      )
    )
      return;
    const removed = new Set<string>();
    for (const id of ids) {
      try {
        await api(`/api/spaces/${spaceId}/items/${id}`, { method: 'DELETE', adminKey });
        removed.add(id);
      } catch {
        /* einzelne Fehler ignorieren, Rest weiterverarbeiten */
      }
    }
    setDetails((prev) => {
      const d = prev[spaceId];
      if (!d?.items) return prev;
      return { ...prev, [spaceId]: { ...d, items: d.items.filter((i) => !removed.has(i.id)) } };
    });
  };

  if (!authed) {
    return (
      <>
        <TopBar />
        <div className="center-page">
          <div className="panel">
            <h1>Admin</h1>
            <p className="sub">Gib den Admin-Schlüssel ein, um alle Bereiche zu verwalten.</p>
            {error && <div className="error-box">{error}</div>}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void load(adminKey);
              }}
            >
              <div className="field">
                <input
                  className="input"
                  type="password"
                  placeholder="Admin-Schlüssel"
                  value={adminKey}
                  onChange={(e) => setAdminKey(e.target.value)}
                  autoFocus
                />
              </div>
              <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
                {busy ? 'Prüfe…' : 'Anmelden'}
              </button>
            </form>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar>
        <Link className="btn btn-sm btn-primary" to="/new">
          + Neuer Bereich
        </Link>
      </TopBar>
      <div className="container" style={{ padding: '28px 20px 60px' }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 26 }}>Bereiche</h1>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              adminKeyStore.clear();
              setAuthed(false);
              setAdminKey('');
            }}
          >
            Abmelden
          </button>
        </div>

        {spaces.length === 0 ? (
          <div className="empty">
            <div className="big">📂</div>
            Noch keine Bereiche. <Link to="/new">Jetzt einen erstellen</Link>.
          </div>
        ) : (
          <div className="admin-accordion">
            {spaces.map((s) => {
              const isOpen = expanded.has(s.id);
              const detail = details[s.id];
              return (
                <div className={`admin-space${isOpen ? ' open' : ''}`} key={s.id}>
                  <button className="admin-space-head" onClick={() => toggle(s.id)}>
                    <span className={`chevron${isOpen ? ' open' : ''}`}>▸</span>
                    <div className="grow">
                      <div className="nm">{s.name}</div>
                      <div className="faint" style={{ fontSize: 13 }}>
                        /s/{s.slug} · {formatDate(s.createdAt)}
                      </div>
                    </div>
                    <span className="tag">{s.itemCount ?? 0} aktiv</span>
                    {(s.archivedCount ?? 0) > 0 && (
                      <span className="tag">{s.archivedCount} archiviert</span>
                    )}
                    {(s.deletedCount ?? 0) > 0 && (
                      <span className="tag tag-danger">{s.deletedCount} gelöscht</span>
                    )}
                    {s.hasPassword && <span className="tag">🔒</span>}
                  </button>

                  {isOpen && (
                    <div className="admin-space-body">
                      <div className="row wrap" style={{ marginBottom: 6 }}>
                        <Link className="btn btn-sm" to={`/s/${s.slug}`}>
                          Galerie öffnen
                        </Link>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => void loadDetail(s.id)}
                        >
                          Aktualisieren
                        </button>
                        <div className="spacer" />
                        <button className="btn btn-sm btn-danger" onClick={() => removeSpace(s)}>
                          Bereich löschen
                        </button>
                      </div>

                      {!detail || detail.status === 'loading' ? (
                        <div className="row" style={{ padding: '20px 0' }}>
                          <span className="spinner" /> <span className="muted">Lade Medien…</span>
                        </div>
                      ) : detail.status === 'error' ? (
                        <div className="error-box">{detail.error}</div>
                      ) : (
                        <AdminSpaceItems
                          spaceId={s.id}
                          token={detail.token!}
                          items={detail.items ?? []}
                          onSetState={setItemState}
                          onPermanentDelete={permanentDelete}
                          onBulkSetState={bulkSetState}
                          onBulkPermanentDelete={bulkPermanentDelete}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function AdminSpaceItems({
  spaceId,
  token,
  items,
  onSetState,
  onPermanentDelete,
  onBulkSetState,
  onBulkPermanentDelete,
}: {
  spaceId: string;
  token: string;
  items: Item[];
  onSetState: (spaceId: string, item: Item, state: ItemState) => void;
  onPermanentDelete: (spaceId: string, item: Item) => void;
  onBulkSetState: (spaceId: string, ids: string[], state: ItemState) => void | Promise<void>;
  onBulkPermanentDelete: (spaceId: string, ids: string[]) => void | Promise<void>;
}) {
  const groups: ItemState[] = ['active', 'archived', 'deleted'];
  return (
    <>
      {groups.map((state) => (
        <AdminGroup
          key={state}
          spaceId={spaceId}
          token={token}
          state={state}
          items={items.filter((i) => i.state === state)}
          onSetState={onSetState}
          onPermanentDelete={onPermanentDelete}
          onBulkSetState={onBulkSetState}
          onBulkPermanentDelete={onBulkPermanentDelete}
        />
      ))}
    </>
  );
}

function AdminGroup({
  spaceId,
  token,
  state,
  items,
  onSetState,
  onPermanentDelete,
  onBulkSetState,
  onBulkPermanentDelete,
}: {
  spaceId: string;
  token: string;
  state: ItemState;
  items: Item[];
  onSetState: (spaceId: string, item: Item, state: ItemState) => void;
  onPermanentDelete: (spaceId: string, item: Item) => void;
  onBulkSetState: (spaceId: string, ids: string[], state: ItemState) => void | Promise<void>;
  onBulkPermanentDelete: (spaceId: string, ids: string[]) => void | Promise<void>;
}) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Auswahl auf tatsächlich (noch) vorhandene Medien dieser Gruppe beschränken.
  const validIds = new Set(items.map((i) => i.id));
  const selectedIds = Array.from(selected).filter((id) => validIds.has(id));
  const allSelected = items.length > 0 && selectedIds.length === items.length;

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));
  };

  const runBulkState = async (target: ItemState) => {
    if (selectedIds.length === 0) return;
    await onBulkSetState(spaceId, selectedIds, target);
    exitSelect();
  };

  const runBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    await onBulkPermanentDelete(spaceId, selectedIds);
    // Nach dem Löschen sind die Einträge weg; Auswahl leeren.
    setSelected(new Set());
  };

  return (
    <div className="admin-group">
      <div className="admin-group-head">
        <h3>{STATE_LABEL[state]}</h3>
        <span className="count">{items.length}</span>
        <div className="spacer" />
        {items.length > 0 &&
          (selectMode ? (
            <>
              <span className="faint" style={{ fontSize: 13 }}>
                {selectedIds.length} ausgewählt
              </span>
              <button className="btn btn-sm" onClick={toggleAll}>
                {allSelected ? 'Auswahl aufheben' : 'Alle auswählen'}
              </button>
              {state !== 'active' && (
                <button
                  className="btn btn-sm"
                  disabled={selectedIds.length === 0}
                  onClick={() => void runBulkState('active')}
                >
                  Wiederherstellen
                </button>
              )}
              {state !== 'archived' && (
                <button
                  className="btn btn-sm"
                  disabled={selectedIds.length === 0}
                  onClick={() => void runBulkState('archived')}
                >
                  Archivieren
                </button>
              )}
              <button
                className="btn btn-sm btn-danger"
                disabled={selectedIds.length === 0}
                onClick={() => void runBulkDelete()}
              >
                Endgültig löschen
              </button>
              <button className="btn btn-sm btn-ghost" onClick={exitSelect}>
                Fertig
              </button>
            </>
          ) : (
            <button className="btn btn-sm" onClick={() => setSelectMode(true)}>
              Auswählen
            </button>
          ))}
      </div>
      {items.length === 0 ? (
        <div className="faint" style={{ fontSize: 13, padding: '4px 0 8px' }}>
          Keine {STATE_LABEL[state].toLowerCase()}en Medien.
        </div>
      ) : (
        <div className="admin-grid">
          {items.map((item) => (
            <AdminTile
              key={item.id}
              spaceId={spaceId}
              token={token}
              item={item}
              selectMode={selectMode}
              selected={selected.has(item.id)}
              onToggleSelect={toggle}
              onSetState={onSetState}
              onPermanentDelete={onPermanentDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AdminTile({
  spaceId,
  token,
  item,
  selectMode,
  selected,
  onToggleSelect,
  onSetState,
  onPermanentDelete,
}: {
  spaceId: string;
  token: string;
  item: Item;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onSetState: (spaceId: string, item: Item, state: ItemState) => void;
  onPermanentDelete: (spaceId: string, item: Item) => void;
}) {
  const thumb =
    item.kind === 'video'
      ? item.hasPoster
        ? fileUrl(`/files/poster/${item.id}`, token)
        : undefined
      : fileUrl(`/files/thumb/${item.id}`, token);
  const openUrl = fileUrl(`/files/original/${item.id}`, token);

  return (
    <div className={`admin-tile${selected ? ' selected' : ''}`}>
      {selectMode ? (
        <button
          className="admin-thumb"
          onClick={() => onToggleSelect(item.id)}
          title="Auswählen"
        >
          {thumb ? (
            <img src={thumb} alt={item.filename} loading="lazy" />
          ) : (
            <span className="admin-thumb-ph">{item.kind === 'video' ? '🎬' : '🖼️'}</span>
          )}
          {item.kind === 'video' && (
            <span className="admin-dur">
              ▶ {item.duration ? formatDuration(item.duration) : ''}
            </span>
          )}
          <span className={`admin-check${selected ? ' on' : ''}`}>{selected ? '✓' : ''}</span>
        </button>
      ) : (
        <a className="admin-thumb" href={openUrl} target="_blank" rel="noreferrer">
          {thumb ? (
            <img src={thumb} alt={item.filename} loading="lazy" />
          ) : (
            <span className="admin-thumb-ph">{item.kind === 'video' ? '🎬' : '🖼️'}</span>
          )}
          {item.kind === 'video' && (
            <span className="admin-dur">
              ▶ {item.duration ? formatDuration(item.duration) : ''}
            </span>
          )}
        </a>
      )}
      <div className="admin-tile-meta">
        <div className="admin-tile-name" title={item.filename}>
          {item.filename}
        </div>
        <div className="faint" style={{ fontSize: 12 }}>
          {item.uploaderName} · {formatBytes(item.sizeBytes)}
        </div>
      </div>
      {!selectMode && (
        <div className="admin-tile-actions">
          {item.state !== 'active' && (
            <button
              className="btn btn-sm"
              onClick={() => onSetState(spaceId, item, 'active')}
              title="In die Galerie zurückholen"
            >
              Wiederherstellen
            </button>
          )}
          {item.state === 'active' && (
            <button className="btn btn-sm" onClick={() => onSetState(spaceId, item, 'archived')}>
              Archivieren
            </button>
          )}
          <button
            className="btn btn-sm btn-danger"
            onClick={() => onPermanentDelete(spaceId, item)}
            title="Endgültig löschen (unwiderruflich)"
          >
            Endgültig löschen
          </button>
        </div>
      )}
    </div>
  );
}
