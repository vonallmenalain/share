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
}: {
  spaceId: string;
  token: string;
  items: Item[];
  onSetState: (spaceId: string, item: Item, state: ItemState) => void;
  onPermanentDelete: (spaceId: string, item: Item) => void;
}) {
  const groups: ItemState[] = ['active', 'archived', 'deleted'];
  return (
    <>
      {groups.map((state) => {
        const group = items.filter((i) => i.state === state);
        return (
          <div key={state} className="admin-group">
            <div className="admin-group-head">
              <h3>{STATE_LABEL[state]}</h3>
              <span className="count">{group.length}</span>
            </div>
            {group.length === 0 ? (
              <div className="faint" style={{ fontSize: 13, padding: '4px 0 8px' }}>
                Keine {STATE_LABEL[state].toLowerCase()}en Medien.
              </div>
            ) : (
              <div className="admin-grid">
                {group.map((item) => (
                  <AdminTile
                    key={item.id}
                    spaceId={spaceId}
                    token={token}
                    item={item}
                    onSetState={onSetState}
                    onPermanentDelete={onPermanentDelete}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function AdminTile({
  spaceId,
  token,
  item,
  onSetState,
  onPermanentDelete,
}: {
  spaceId: string;
  token: string;
  item: Item;
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
    <div className="admin-tile">
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
      <div className="admin-tile-meta">
        <div className="admin-tile-name" title={item.filename}>
          {item.filename}
        </div>
        <div className="faint" style={{ fontSize: 12 }}>
          {item.uploaderName} · {formatBytes(item.sizeBytes)}
        </div>
      </div>
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
    </div>
  );
}
