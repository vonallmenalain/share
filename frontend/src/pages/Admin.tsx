import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import TopBar from '../components/TopBar';
import ShareIcon from '../components/ShareIcon';
import {
  AccessLog,
  AccessLogsResponse,
  api,
  fileUrl,
  Item,
  ItemState,
  ModuleKey,
  Participant,
  Space,
} from '../api/client';
import { shareItems } from '../lib/share';
import { adminKeyStore } from '../lib/storage';
import { colorForName, initialsOf } from '../lib/avatar';
import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatDayHeading,
  formatDuration,
} from '../lib/format';

interface SpaceDetail {
  status: 'loading' | 'ready' | 'error';
  token?: string;
  items?: Item[];
  error?: string;
}

const STATE_LABEL: Record<ItemState, string> = {
  active: 'Aktiv',
  deleted: 'Gelöscht',
};

function downloadOriginal(item: Item, token: string) {
  const a = document.createElement('a');
  a.href = fileUrl(`/files/original/${item.id}`, token);
  a.download = item.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Teilt Medien über das native Teilen-Menü. Klappt das nicht (z. B. Desktop
// ohne Datei-Teilen), werden die Originale als Ausweichlösung heruntergeladen.
async function shareWithFallback(list: Item[], token: string): Promise<void> {
  if (list.length === 0) return;
  const outcome = await shareItems(list, token);
  if (outcome === 'unsupported') {
    for (const it of list) downloadOriginal(it, token);
    alert(
      'Direktes Teilen wird von diesem Gerät bzw. Browser nicht unterstützt. ' +
        'Die Datei(en) werden stattdessen heruntergeladen.',
    );
  } else if (outcome === 'error') {
    alert('Teilen fehlgeschlagen. Bitte versuche es noch einmal.');
  }
}

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

  const updateSpace = (updated: Space) => {
    setSpaces((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
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

  // Sammelaktion: Zustand mehrerer Medien setzen (wiederherstellen/löschen).
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
                    {(s.deletedCount ?? 0) > 0 && (
                      <span className="tag tag-danger">{s.deletedCount} gelöscht</span>
                    )}
                    {(s.accessCount ?? 0) > 0 && (
                      <span className="tag" title="Protokollierte Zugriffe">
                        👁 {s.accessCount} Zugriffe
                      </span>
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

                      <AdminModulePanel spaceId={s.id} adminKey={adminKey} />

                      <AdminParticipantsPanel
                        space={s}
                        adminKey={adminKey}
                        onUpdateSpace={updateSpace}
                      />

                      <AccessLogPanel spaceId={s.id} adminKey={adminKey} />

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

const MODULE_META: { key: Exclude<ModuleKey, 'photos'>; label: string; icon: string }[] = [
  { key: 'finance', label: 'Finanzen', icon: '💰' },
  { key: 'shopping', label: 'Einkaufsliste', icon: '🛒' },
  { key: 'notes', label: 'Notizen', icon: '📝' },
  { key: 'calendar', label: 'Kalender', icon: '📅' },
];

const MODULE_CURRENCIES = ['CHF', 'EUR', 'USD', 'GBP'];

/** Adminbereich: aktivierte Module eines Bereichs anzeigen und ändern. */
function AdminModulePanel({ spaceId, adminKey }: { spaceId: string; adminKey: string }) {
  const [modules, setModules] = useState<Set<ModuleKey>>(new Set(['photos']));
  const [currency, setCurrency] = useState('CHF');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await api<{ modules: ModuleKey[]; financeCurrency: string | null }>(
          `/api/spaces/${spaceId}/modules`,
          { adminKey },
        );
        if (cancelled) return;
        setModules(new Set(res.modules));
        if (res.financeCurrency) setCurrency(res.financeCurrency);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId, adminKey]);

  const toggle = (key: ModuleKey) => {
    if (key === 'photos') return;
    setModules((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setMsg('');
    try {
      const res = await api<{ modules: ModuleKey[]; financeCurrency: string | null }>(
        `/api/spaces/${spaceId}/modules`,
        {
          method: 'PATCH',
          adminKey,
          body: {
            modules: Array.from(modules),
            financeCurrency: modules.has('finance') ? currency : undefined,
          },
        },
      );
      setModules(new Set(res.modules));
      if (res.financeCurrency) setCurrency(res.financeCurrency);
      setMsg('Gespeichert ✓');
      setTimeout(() => setMsg(''), 1800);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Fehler beim Speichern.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-module-panel">
        <span className="spinner" /> <span className="muted">Lade Module…</span>
      </div>
    );
  }

  return (
    <div className="admin-module-panel">
      <div className="admin-module-title">Module</div>
      <div className="admin-module-row">
        <span className="tag">🖼️ Fotos &amp; Videos (immer aktiv)</span>
        {MODULE_META.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`tag tag-toggle${modules.has(m.key) ? ' active' : ''}`}
            onClick={() => toggle(m.key)}
            aria-pressed={modules.has(m.key)}
          >
            {m.icon} {m.label} {modules.has(m.key) ? '✓' : ''}
          </button>
        ))}
      </div>
      {modules.has('finance') && (
        <div className="row" style={{ marginTop: 8, alignItems: 'center', gap: 8 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            Währung:
          </span>
          <select className="input" style={{ width: 'auto' }} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {MODULE_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="row" style={{ marginTop: 8, alignItems: 'center', gap: 10 }}>
        <button className="btn btn-sm btn-primary" disabled={saving} onClick={save}>
          {saving ? 'Speichere…' : 'Module speichern'}
        </button>
        {msg && <span className="muted" style={{ fontSize: 13 }}>{msg}</span>}
      </div>
    </div>
  );
}

/**
 * Adminbereich: Pflicht-Einstellung für den Teilnehmer-Code (PIN) sowie
 * Verwaltung aller Identitäten eines Bereichs. Von hier aus kann der Code
 * jeder Person zurückgesetzt werden – die Antwort auf „Code vergessen?": die
 * Person wendet sich an den Administrator, der den Code hier entfernt, damit
 * sie beim nächsten Auswählen ihres Namens einen neuen festlegen kann.
 */
function AdminParticipantsPanel({
  space,
  adminKey,
  onUpdateSpace,
}: {
  space: Space;
  adminKey: string;
  onUpdateSpace: (space: Space) => void;
}) {
  const [requirePin, setRequirePin] = useState(space.requireParticipantPin);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policyMsg, setPolicyMsg] = useState('');

  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [error, setError] = useState('');
  const [resettingId, setResettingId] = useState<string | null>(null);

  useEffect(() => {
    setRequirePin(space.requireParticipantPin);
  }, [space.requireParticipantPin]);

  const savePolicy = async () => {
    setSavingPolicy(true);
    setPolicyMsg('');
    try {
      const res = await api<{ space: Space }>(`/api/spaces/${space.id}/participant-policy`, {
        method: 'PATCH',
        adminKey,
        body: { requireParticipantPin: requirePin },
      });
      onUpdateSpace(res.space);
      setPolicyMsg('Gespeichert ✓');
      setTimeout(() => setPolicyMsg(''), 1800);
    } catch (err) {
      setPolicyMsg(err instanceof Error ? err.message : 'Fehler beim Speichern.');
    } finally {
      setSavingPolicy(false);
    }
  };

  const loadParticipants = async () => {
    setStatus('loading');
    setError('');
    try {
      const res = await api<{ participants: Participant[] }>(
        `/api/spaces/${space.id}/participants`,
        { adminKey },
      );
      setParticipants(res.participants);
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Laden fehlgeschlagen.');
      setStatus('error');
    }
  };

  const toggleOpen = () => {
    setOpen((o) => {
      const next = !o;
      if (next && status === 'idle') void loadParticipants();
      return next;
    });
  };

  const resetPin = async (p: Participant) => {
    if (!confirm(`Code von „${p.name}“ zurücksetzen? Die Person kann danach einen neuen festlegen.`))
      return;
    setResettingId(p.id);
    try {
      const res = await api<{ participant: Participant }>(
        `/api/spaces/${space.id}/participants/${p.id}/reset-pin`,
        { method: 'POST', adminKey },
      );
      setParticipants((prev) => prev.map((x) => (x.id === p.id ? res.participant : x)));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Zurücksetzen fehlgeschlagen.');
    } finally {
      setResettingId(null);
    }
  };

  return (
    <div className="admin-module-panel">
      <div className="admin-module-title">Wer bist du? &amp; Code (PIN)</div>
      <label className="checkbox-line">
        <input type="checkbox" checked={requirePin} onChange={(e) => setRequirePin(e.target.checked)} />
        Code für neue Identitäten in diesem Bereich zur Pflicht machen
      </label>
      <div className="row" style={{ marginTop: 8, alignItems: 'center', gap: 10 }}>
        <button
          className="btn btn-sm btn-primary"
          disabled={savingPolicy || requirePin === space.requireParticipantPin}
          onClick={savePolicy}
        >
          {savingPolicy ? 'Speichere…' : 'Einstellung speichern'}
        </button>
        {policyMsg && <span className="muted" style={{ fontSize: 13 }}>{policyMsg}</span>}
      </div>

      <div className="access-panel" style={{ marginTop: 14 }}>
        <button type="button" className="access-toggle" onClick={toggleOpen}>
          <span className={`chevron${open ? ' open' : ''}`}>▸</span>
          <span className="grow">Personen &amp; Codes verwalten</span>
          {participants.length > 0 && <span className="tag">{participants.length}</span>}
        </button>

        {open && (
          <div className="access-body">
            {status === 'loading' ? (
              <div className="row" style={{ padding: '10px 0' }}>
                <span className="spinner" /> <span className="muted">Lade Personen…</span>
              </div>
            ) : status === 'error' ? (
              <div className="error-box">{error}</div>
            ) : participants.length === 0 ? (
              <div className="faint" style={{ fontSize: 13, padding: '8px 0' }}>
                Noch keine Person hat sich in diesem Bereich angelegt.
              </div>
            ) : (
              <ul className="admin-participant-list">
                {participants.map((p) => (
                  <li key={p.id} className="admin-participant-row">
                    <span className="avatar sm" style={{ background: p.color || colorForName(p.name) }}>
                      {initialsOf(p.name)}
                    </span>
                    <span className="grow">
                      {p.name}
                      {p.archived && (
                        <span className="tag" style={{ marginLeft: 6 }}>
                          archiviert
                        </span>
                      )}
                    </span>
                    {p.hasPin ? (
                      <button
                        className="btn btn-sm btn-danger"
                        disabled={resettingId === p.id}
                        onClick={() => void resetPin(p)}
                        title="Code entfernen, damit die Person einen neuen festlegen kann"
                      >
                        {resettingId === p.id ? 'Setze zurück…' : 'Code zurücksetzen'}
                      </button>
                    ) : (
                      <span className="faint" style={{ fontSize: 13 }}>
                        kein Code gesetzt
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
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
  const groups: ItemState[] = ['active', 'deleted'];
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
  const [sharing, setSharing] = useState(false);

  // Auswahl auf tatsächlich (noch) vorhandene Medien dieser Gruppe beschränken.
  const validIds = new Set(items.map((i) => i.id));
  const selectedIds = Array.from(selected).filter((id) => validIds.has(id));
  const allSelected = items.length > 0 && selectedIds.length === items.length;

  const share = async (list: Item[]) => {
    if (list.length === 0 || sharing) return;
    setSharing(true);
    try {
      await shareWithFallback(list, token);
    } finally {
      setSharing(false);
    }
  };

  const runShare = () => share(items.filter((i) => selectedIds.includes(i.id)));

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
              <button
                className="btn btn-sm btn-share"
                disabled={selectedIds.length === 0 || sharing}
                onClick={() => void runShare()}
                title="Ausgewählte Medien teilen"
              >
                {sharing ? <span className="spinner" /> : <ShareIcon size={15} />}
                Teilen
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
              onShare={(it) => share([it])}
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
  onShare,
}: {
  spaceId: string;
  token: string;
  item: Item;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onSetState: (spaceId: string, item: Item, state: ItemState) => void;
  onPermanentDelete: (spaceId: string, item: Item) => void;
  onShare: (item: Item) => void | Promise<void>;
}) {
  const [sharing, setSharing] = useState(false);
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
          <button
            className="btn btn-sm btn-share"
            disabled={sharing}
            onClick={async () => {
              if (sharing) return;
              setSharing(true);
              try {
                await onShare(item);
              } finally {
                setSharing(false);
              }
            }}
            title="Teilen"
          >
            {sharing ? <span className="spinner" /> : <ShareIcon size={15} />}
            Teilen
          </button>
          {item.state !== 'active' && (
            <button
              className="btn btn-sm"
              onClick={() => onSetState(spaceId, item, 'active')}
              title="In die Galerie zurückholen"
            >
              Wiederherstellen
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

// ---- Zugriffsstatistik (nur Admin) ----------------------------------------

type LogView = 'list' | 'day' | 'location' | 'ip' | 'visitor' | 'device';
type SortKey = 'at' | 'visitor' | 'location' | 'ip' | 'device';

const LOG_VIEWS: { id: LogView; label: string }[] = [
  { id: 'list', label: 'Alle Zugriffe' },
  { id: 'day', label: 'Pro Tag' },
  { id: 'location', label: 'Pro Standort' },
  { id: 'ip', label: 'Pro IP' },
  { id: 'visitor', label: 'Pro Person' },
  { id: 'device', label: 'Pro Gerät' },
];

/** Kurzer, lesbarer Standort aus den (optionalen) Cloudflare-Geodaten. */
function locationLabel(l: AccessLog): string {
  const parts = [l.city, l.region, l.country].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Unbekannt';
}

/** Vereinfacht den User-Agent zu „Browser · Betriebssystem". */
function shortDevice(ua: string | null): string {
  if (!ua) return 'Unbekannt';
  let os = '';
  if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/mac os x|macintosh/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';
  let br = '';
  if (/edg\//i.test(ua)) br = 'Edge';
  else if (/crios|chrome/i.test(ua)) br = 'Chrome';
  else if (/fxios|firefox/i.test(ua)) br = 'Firefox';
  else if (/safari/i.test(ua)) br = 'Safari';
  const parts = [br, os].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Unbekannt';
}

function AccessLogPanel({ spaceId, adminKey }: { spaceId: string; adminKey: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [data, setData] = useState<AccessLogsResponse | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<LogView>('list');
  const [sortKey, setSortKey] = useState<SortKey>('at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const load = async () => {
    setStatus('loading');
    setError('');
    try {
      const res = await api<AccessLogsResponse>(`/api/spaces/${spaceId}/access-logs`, { adminKey });
      setData(res);
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Laden fehlgeschlagen.');
      setStatus('error');
    }
  };

  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      if (next && status === 'idle') void load();
      return next;
    });
  };

  const clearLogs = async () => {
    if (!confirm('Das komplette Zugriffsprotokoll dieses Bereichs löschen?')) return;
    try {
      await api(`/api/spaces/${spaceId}/access-logs`, { method: 'DELETE', adminKey });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
    }
  };

  const logs = useMemo(() => data?.logs ?? [], [data]);

  const sortedLogs = useMemo(() => {
    const value = (l: AccessLog): string => {
      switch (sortKey) {
        case 'visitor':
          return (l.visitor || '').toLowerCase();
        case 'location':
          return locationLabel(l).toLowerCase();
        case 'ip':
          return l.ip || '';
        case 'device':
          return shortDevice(l.userAgent).toLowerCase();
        default:
          return l.at;
      }
    };
    const arr = [...logs];
    arr.sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [logs, sortKey, sortDir]);

  const groups = useMemo(() => {
    const by = (fn: (l: AccessLog) => string) => {
      const map = new Map<string, { key: string; count: number; last: string }>();
      for (const l of logs) {
        const key = fn(l) || 'Unbekannt';
        const cur = map.get(key);
        if (cur) {
          cur.count++;
          if (l.at > cur.last) cur.last = l.at;
        } else {
          map.set(key, { key, count: 1, last: l.at });
        }
      }
      return Array.from(map.values()).sort(
        (a, b) => b.count - a.count || (a.last < b.last ? 1 : -1),
      );
    };
    return {
      day: by((l) => l.at.slice(0, 10)),
      location: by((l) => locationLabel(l)),
      ip: by((l) => l.ip || 'Unbekannt'),
      visitor: by((l) => l.visitor || 'Unbekannt'),
      device: by((l) => shortDevice(l.userAgent)),
    };
  }, [logs]);

  const setSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'at' ? 'desc' : 'asc');
    }
  };

  const sortArrow = (key: SortKey) => (key === sortKey ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const exportCsv = () => {
    const esc = (v: string | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = [
      'Zeitpunkt',
      'Art',
      'Person',
      'IP',
      'Stadt',
      'Region',
      'Land',
      'PLZ',
      'Breitengrad',
      'Längengrad',
      'Zeitzone',
      'Gerät',
      'User-Agent',
    ].join(',');
    const rows = sortedLogs.map((l) =>
      [
        l.at,
        l.kind === 'enter' ? 'Betreten' : 'Geöffnet',
        l.visitor,
        l.ip,
        l.city,
        l.region,
        l.country,
        l.postal,
        l.latitude,
        l.longitude,
        l.timezone,
        shortDevice(l.userAgent),
        l.userAgent,
      ]
        .map(esc)
        .join(','),
    );
    const csv = [header, ...rows].join('\r\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zugriffe-${spaceId}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const groupRows =
    view === 'day'
      ? groups.day
      : view === 'location'
        ? groups.location
        : view === 'ip'
          ? groups.ip
          : view === 'visitor'
            ? groups.visitor
            : groups.device;
  const maxCount = groupRows.reduce((m, g) => Math.max(m, g.count), 0);

  return (
    <div className="access-panel">
      <button className={`access-toggle${open ? ' open' : ''}`} onClick={toggle}>
        <span className={`chevron${open ? ' open' : ''}`}>▸</span>
        <span className="grow">Zugriffe &amp; Standorte</span>
        {data ? <span className="tag">{data.total}</span> : null}
      </button>

      {open && (
        <div className="access-body">
          {status === 'loading' ? (
            <div className="row" style={{ padding: '14px 0' }}>
              <span className="spinner" /> <span className="muted">Lade Zugriffe…</span>
            </div>
          ) : status === 'error' ? (
            <div className="error-box">{error}</div>
          ) : data ? (
            <>
              <div className="access-summary">
                <div className="access-stat">
                  <div className="n">{data.total}</div>
                  <div className="l">Zugriffe gesamt</div>
                </div>
                <div className="access-stat">
                  <div className="n">{data.uniqueVisitors}</div>
                  <div className="l">Personen</div>
                </div>
                <div className="access-stat">
                  <div className="n">{data.uniqueIps}</div>
                  <div className="l">verschiedene IPs</div>
                </div>
                <div className="access-stat">
                  <div className="n">{logs[0] ? formatDate(logs[0].at) : '–'}</div>
                  <div className="l">letzter Zugriff</div>
                </div>
              </div>

              <div className="row wrap" style={{ gap: 6, margin: '10px 0' }}>
                <div className="segmented sm">
                  {LOG_VIEWS.map((v) => (
                    <button
                      key={v.id}
                      className={view === v.id ? 'active' : ''}
                      onClick={() => setView(v.id)}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                <div className="spacer" />
                <button className="btn btn-sm btn-ghost" onClick={() => void load()}>
                  Aktualisieren
                </button>
                <button
                  className="btn btn-sm"
                  disabled={logs.length === 0}
                  onClick={exportCsv}
                >
                  ↓ CSV
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  disabled={logs.length === 0}
                  onClick={() => void clearLogs()}
                >
                  Protokoll leeren
                </button>
              </div>

              {data.returned < data.total && (
                <div className="faint" style={{ fontSize: 12, marginBottom: 8 }}>
                  Angezeigt werden die neuesten {data.returned} von {data.total} Zugriffen.
                </div>
              )}

              {logs.length === 0 ? (
                <div className="faint" style={{ fontSize: 13, padding: '8px 0' }}>
                  Noch keine Zugriffe protokolliert.
                </div>
              ) : view === 'list' ? (
                <div className="access-scroll">
                  <table className="access-table">
                    <thead>
                      <tr>
                        <th onClick={() => setSort('at')}>Zeitpunkt{sortArrow('at')}</th>
                        <th onClick={() => setSort('visitor')}>Person{sortArrow('visitor')}</th>
                        <th onClick={() => setSort('location')}>Standort{sortArrow('location')}</th>
                        <th onClick={() => setSort('ip')}>IP{sortArrow('ip')}</th>
                        <th onClick={() => setSort('device')}>Gerät{sortArrow('device')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedLogs.map((l) => (
                        <tr key={l.id}>
                          <td title={l.kind === 'enter' ? 'Bereich betreten' : 'App geöffnet'}>
                            {formatDateTime(l.at)}
                          </td>
                          <td>{l.visitor || <span className="faint">–</span>}</td>
                          <td>
                            {l.latitude && l.longitude ? (
                              <a
                                href={`https://www.openstreetmap.org/?mlat=${l.latitude}&mlon=${l.longitude}#map=11/${l.latitude}/${l.longitude}`}
                                target="_blank"
                                rel="noreferrer"
                                title="Auf Karte anzeigen"
                              >
                                {locationLabel(l)}
                              </a>
                            ) : (
                              locationLabel(l)
                            )}
                          </td>
                          <td className="mono">{l.ip || <span className="faint">–</span>}</td>
                          <td title={l.userAgent ?? ''}>{shortDevice(l.userAgent)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="access-groups">
                  {groupRows.map((g) => (
                    <div className="access-group-row" key={g.key}>
                      <div className="lbl">
                        {view === 'day' ? formatDayHeading(g.key) : g.key}
                      </div>
                      <div className="bar-wrap">
                        <div
                          className="bar"
                          style={{ width: `${maxCount ? (g.count / maxCount) * 100 : 0}%` }}
                        />
                      </div>
                      <div className="cnt">{g.count}</div>
                    </div>
                  ))}
                </div>
              )}

              <div className="faint" style={{ fontSize: 12, marginTop: 10 }}>
                Standortangaben stammen aus den Geodaten des Cloudflare-Netzwerks und sind nur so
                genau wie diese. Dieses Protokoll ist ausschliesslich hier im Adminbereich sichtbar.
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
