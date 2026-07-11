import { useCallback, useState } from 'react';
import { api, ShoppingItem } from '../../api/client';
import { useSpaceSessionContext } from '../../context/SpaceSessionContext';
import { useModuleData } from '../../lib/useModuleData';
import { useParticipants, participantName } from '../../lib/useParticipants';

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
  const open = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);

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

  const renderRow = (item: ShoppingItem) => {
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
    return (
      <li key={item.id} className={`shopping-row${item.checked ? ' checked' : ''}`}>
        <label className="shopping-check">
          <input type="checkbox" checked={item.checked} onChange={() => toggle(item)} />
          <span className="shopping-text">
            {item.text}
            {item.quantity ? <span className="shopping-qty-badge">{item.quantity}</span> : null}
          </span>
        </label>
        <span className="shopping-meta">
          {item.checked && checker ? `✓ ${checker}` : creator ? creator : ''}
        </span>
        <span className="shopping-actions">
          <button className="btn btn-sm btn-ghost" onClick={() => startEdit(item)} title="Bearbeiten">
            ✎
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => remove(item)} title="Löschen">
            ✕
          </button>
        </span>
      </li>
    );
  };

  return (
    <div className="container module-page">
      <div className="module-head">
        <h1 className="space-title">Einkaufsliste</h1>
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
          <ul className="shopping-list">{open.map(renderRow)}</ul>

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
              {showDone && <ul className="shopping-list">{done.map(renderRow)}</ul>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
