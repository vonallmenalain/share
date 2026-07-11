import { useCallback, useMemo, useState } from 'react';
import { api, ShoppingItem } from '../../api/client';
import { useSpaceSessionContext } from '../../context/SpaceSessionContext';
import { useModuleData } from '../../lib/useModuleData';
import { useParticipants, participantName } from '../../lib/useParticipants';
import { formatShortDateTime } from '../../lib/format';
import { shoppingSortStore, ShoppingSortMode } from '../../lib/storage';
import { useReorderList } from '../../lib/useReorderList';

/** Sortiert eine Gruppe (offen/erledigt) standardmässig nach Aktualität. */
function sortByRecency(items: ShoppingItem[], byField: 'createdAt' | 'checkedAt'): ShoppingItem[] {
  return [...items].sort((a, b) => {
    const av = (byField === 'checkedAt' ? a.checkedAt : a.createdAt) ?? a.createdAt;
    const bv = (byField === 'checkedAt' ? b.checkedAt : b.createdAt) ?? b.createdAt;
    return bv.localeCompare(av);
  });
}

export default function ShoppingPage() {
  const { slug, token } = useSpaceSessionContext();
  const { participants, currentId } = useParticipants(slug, token);
  const participantId = currentId ?? undefined;

  const [text, setText] = useState('');
  const [quantity, setQuantity] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editQty, setEditQty] = useState('');
  const [sortMode, setSortMode] = useState<ShoppingSortMode>(() => shoppingSortStore.get(slug));

  const load = useCallback(
    async (signal: AbortSignal) => {
      const res = await api<{ items: ShoppingItem[] }>('/api/shopping', { token, signal });
      return res.items;
    },
    [token],
  );

  const { data, loading, setData, reload } = useModuleData<ShoppingItem[]>(load, [token], {
    intervalMs: 5000,
  });
  const items = data ?? [];

  // In der Standard-Sortierung stehen die zuletzt hinzugefügten (offen) bzw.
  // zuletzt abgehakten (erledigt) Einträge immer oben. Im manuellen Modus
  // gilt die selbst per Ziehen festgelegte Reihenfolge (= gespeicherte Position).
  const open = useMemo(() => {
    const list = items.filter((i) => !i.checked);
    return sortMode === 'manual' ? [...list].sort((a, b) => a.position - b.position) : sortByRecency(list, 'createdAt');
  }, [items, sortMode]);
  const done = useMemo(() => {
    const list = items.filter((i) => i.checked);
    return sortMode === 'manual' ? [...list].sort((a, b) => a.position - b.position) : sortByRecency(list, 'checkedAt');
  }, [items, sortMode]);

  const changeSortMode = (mode: ShoppingSortMode) => {
    setSortMode(mode);
    shoppingSortStore.set(slug, mode);
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    setQuantity('');
    try {
      const res = await api<{ item: ShoppingItem }>('/api/shopping', {
        method: 'POST',
        token,
        participantId,
        body: { text: t, quantity: quantity.trim() || undefined },
      });
      setData((prev) => [...(prev ?? []), res.item]);
    } catch {
      reload();
    }
  };

  const toggle = async (item: ShoppingItem) => {
    // Optimistisch umschalten.
    setData((prev) =>
      (prev ?? []).map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i)),
    );
    try {
      const res = await api<{ item: ShoppingItem }>(`/api/shopping/${item.id}/toggle`, {
        method: 'POST',
        token,
        participantId,
        body: { checked: !item.checked },
      });
      setData((prev) => (prev ?? []).map((i) => (i.id === item.id ? res.item : i)));
    } catch {
      reload();
    }
  };

  const remove = async (item: ShoppingItem) => {
    setData((prev) => (prev ?? []).filter((i) => i.id !== item.id));
    try {
      await api(`/api/shopping/${item.id}`, { method: 'DELETE', token, participantId });
    } catch {
      reload();
    }
  };

  const startEdit = (item: ShoppingItem) => {
    setEditingId(item.id);
    setEditText(item.text);
    setEditQty(item.quantity ?? '');
  };

  const saveEdit = async (item: ShoppingItem) => {
    const t = editText.trim();
    if (!t) return;
    setEditingId(null);
    setData((prev) =>
      (prev ?? []).map((i) => (i.id === item.id ? { ...i, text: t, quantity: editQty.trim() || null } : i)),
    );
    try {
      const res = await api<{ item: ShoppingItem }>(`/api/shopping/${item.id}`, {
        method: 'PATCH',
        token,
        participantId,
        body: { text: t, quantity: editQty.trim() || null },
      });
      setData((prev) => (prev ?? []).map((i) => (i.id === item.id ? res.item : i)));
    } catch {
      reload();
    }
  };

  /** Reihenfolge einer Gruppe (offen ODER erledigt) neu speichern – lokal
   * sofort (optimistisch) und im Hintergrund auf dem Server. */
  const commitOrder = (predicate: (i: ShoppingItem) => boolean, orderedIds: string[]) => {
    setData((prev) => {
      const list = prev ?? [];
      const positioned = new Map(orderedIds.map((id, idx) => [id, idx]));
      return list.map((i) => (predicate(i) && positioned.has(i.id) ? { ...i, position: positioned.get(i.id)! } : i));
    });
    api('/api/shopping/order', { method: 'PATCH', token, participantId, body: { order: orderedIds } }).catch(() =>
      reload(),
    );
  };

  const openReorder = useReorderList();
  const doneReorder = useReorderList();
  const manual = sortMode === 'manual';

  const openIds = open.map((i) => i.id);
  const doneIds = done.map((i) => i.id);
  const openDisplayIds = manual && openReorder.previewOrder ? openReorder.previewOrder : openIds;
  const doneDisplayIds = manual && doneReorder.previewOrder ? doneReorder.previewOrder : doneIds;
  const openById = useMemo(() => new Map(open.map((i) => [i.id, i])), [open]);
  const doneById = useMemo(() => new Map(done.map((i) => [i.id, i])), [done]);

  const renderRow = (
    item: ShoppingItem,
    reorder: typeof openReorder,
    order: string[],
    onReorder: (orderedIds: string[]) => void,
  ) => {
    if (editingId === item.id) {
      return (
        <li key={item.id} className="shopping-row editing">
          <input
            className="input"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            autoFocus
          />
          <input
            className="input shopping-qty"
            placeholder="Menge"
            value={editQty}
            onChange={(e) => setEditQty(e.target.value)}
          />
          <button className="btn btn-sm btn-primary" onClick={() => saveEdit(item)}>
            Speichern
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setEditingId(null)}>
            Abbrechen
          </button>
        </li>
      );
    }
    const checker = item.checkedByParticipantId
      ? participantName(participants, item.checkedByParticipantId)
      : null;
    const creator = item.createdByParticipantId
      ? participantName(participants, item.createdByParticipantId)
      : null;
    const dragging = reorder.dragId === item.id;
    return (
      <li
        key={item.id}
        ref={manual ? reorder.setNodeRef(item.id) : undefined}
        className={`shopping-row${item.checked ? ' checked' : ''}${dragging ? ' dragging' : ''}`}
      >
        {manual && (
          <span
            className="shopping-drag-handle"
            aria-label="Ziehen zum Neuanordnen"
            onPointerDown={reorder.beginDrag(item.id, order, onReorder)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="4" cy="3" r="1.4" fill="currentColor" />
              <circle cx="4" cy="8" r="1.4" fill="currentColor" />
              <circle cx="4" cy="13" r="1.4" fill="currentColor" />
              <circle cx="11" cy="3" r="1.4" fill="currentColor" />
              <circle cx="11" cy="8" r="1.4" fill="currentColor" />
              <circle cx="11" cy="13" r="1.4" fill="currentColor" />
            </svg>
          </span>
        )}
        <label className="shopping-check">
          <input type="checkbox" checked={item.checked} onChange={() => toggle(item)} />
          <span className="shopping-text">
            {item.text}
            {item.quantity ? <span className="shopping-qty-badge">{item.quantity}</span> : null}
          </span>
        </label>
        <div className="shopping-row-side">
          <span className="shopping-meta">
            <span className="shopping-meta-line">
              <span className="shopping-meta-name">{creator ?? 'Unbekannt'}</span>
              <span className="shopping-meta-date">{formatShortDateTime(item.createdAt)}</span>
            </span>
            {item.checked && (
              <span className="shopping-meta-line shopping-meta-checked">
                ✓ {checker ?? 'Unbekannt'}
                <span className="shopping-meta-date">{formatShortDateTime(item.checkedAt)}</span>
              </span>
            )}
          </span>
          <span className="shopping-actions">
            <button className="btn btn-sm btn-ghost" onClick={() => startEdit(item)} title="Bearbeiten">
              ✎
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => remove(item)} title="Löschen">
              ✕
            </button>
          </span>
        </div>
      </li>
    );
  };

  return (
    <div className="container module-page">
      <div className="module-head">
        <h1 className="space-title">Einkaufsliste</h1>
        <div className="spacer" />
        <div className="segmented sm shopping-sort-switch" role="tablist" aria-label="Sortierung">
          <button
            type="button"
            className={sortMode === 'recent' ? 'active' : ''}
            onClick={() => changeSortMode('recent')}
            title="Neueste zuerst"
          >
            Standard
          </button>
          <button
            type="button"
            className={sortMode === 'manual' ? 'active' : ''}
            onClick={() => changeSortMode('manual')}
            title="Reihenfolge selbst per Ziehen festlegen"
          >
            Manuell
          </button>
        </div>
      </div>

      <form className="shopping-add" onSubmit={add}>
        <input
          className="input"
          placeholder="Was fehlt? (Enter zum Hinzufügen)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <input
          className="input shopping-qty"
          placeholder="Menge"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <button className="btn btn-primary" disabled={!text.trim()}>
          Hinzufügen
        </button>
      </form>

      {loading && items.length === 0 ? (
        <div className="center-page" style={{ minHeight: 120 }}>
          <span className="spinner lg" />
        </div>
      ) : (
        <>
          {open.length === 0 && done.length === 0 && (
            <div className="empty-hint">Noch nichts auf der Liste – füge oben etwas hinzu.</div>
          )}
          <ul className="shopping-list">
            {openDisplayIds.map((id) => {
              const item = openById.get(id);
              if (!item) return null;
              return renderRow(item, openReorder, openIds, (order) => commitOrder((i) => !i.checked, order));
            })}
          </ul>

          {done.length > 0 && (
            <div className="shopping-done">
              <button
                type="button"
                className="shopping-done-toggle"
                onClick={() => setShowDone((v) => !v)}
                aria-expanded={showDone}
              >
                <span className={`chevron${showDone ? ' open' : ''}`}>▸</span>
                Erledigt ({done.length})
              </button>
              {showDone && (
                <ul className="shopping-list">
                  {doneDisplayIds.map((id) => {
                    const item = doneById.get(id);
                    if (!item) return null;
                    return renderRow(item, doneReorder, doneIds, (order) => commitOrder((i) => i.checked, order));
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
