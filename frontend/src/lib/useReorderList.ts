import { useCallback, useRef, useState } from 'react';

type CommitFn = (orderedIds: string[]) => void;

interface DragState {
  id: string;
  startIndex: number;
  startY: number;
  itemHeight: number;
  order: string[];
  commit: CommitFn;
}

/**
 * Erlaubt es, eine Liste per Ziehen an einem dedizierten Griff-Element neu
 * anzuordnen – identisch mit Maus und Touch, da durchgehend Pointer Events
 * verwendet werden. Während des Ziehens folgt die gezogene Zeile dem Finger
 * bzw. dem Mauszeiger, überfahrene Zeilen rutschen weich an ihren neuen Platz
 * (FLIP-Technik: Position vor der Umsortierung merken, danach die Differenz
 * animiert auf 0 zurückfahren).
 *
 * Verwendung: An jede Zeile per `setNodeRef(id)` einen Ref hängen und den
 * Ziehgriff mit `onPointerDown={beginDrag(id, order, commit)}` versehen.
 * `previewOrder` liefert – nur während des Ziehens – die aktuell sichtbare
 * Reihenfolge (sonst `null`, dann gilt die von aussen übergebene Reihenfolge).
 */
export function useReorderList() {
  const [dragId, setDragId] = useState<string | null>(null);
  const [previewOrder, setPreviewOrder] = useState<string[] | null>(null);
  const nodesRef = useRef(new Map<string, HTMLElement>());
  const dragRef = useRef<DragState | null>(null);

  const setNodeRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) nodesRef.current.set(id, el);
      else nodesRef.current.delete(id);
    },
    [],
  );

  const flip = (before: Map<string, DOMRect>) => {
    before.forEach((rect, id) => {
      const node = nodesRef.current.get(id);
      if (!node) return;
      const after = node.getBoundingClientRect();
      const dy = rect.top - after.top;
      if (Math.abs(dy) < 0.5) return;
      node.style.transition = 'none';
      node.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => {
        node.style.transition = 'transform 200ms cubic-bezier(0.2, 0, 0, 1)';
        node.style.transform = '';
      });
    });
  };

  const beginDrag = useCallback(
    (id: string, order: string[], commit: CommitFn) => (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const node = nodesRef.current.get(id);
      if (!node) return;
      e.preventDefault();
      const rect = node.getBoundingClientRect();
      dragRef.current = {
        id,
        startIndex: order.indexOf(id),
        startY: e.clientY,
        itemHeight: rect.height || 1,
        order: order.slice(),
        commit,
      };
      setDragId(id);
      setPreviewOrder(order.slice());
      try {
        node.setPointerCapture(e.pointerId);
      } catch {
        /* nicht kritisch, z. B. in Tests ohne echtes Pointer-Capture */
      }
      node.style.zIndex = '5';

      const onMove = (ev: PointerEvent) => {
        const st = dragRef.current;
        if (!st) return;
        const dy = ev.clientY - st.startY;
        const dragNode = nodesRef.current.get(st.id);
        if (dragNode) dragNode.style.transform = `translateY(${dy}px)`;
        setPreviewOrder((prev) => {
          const cur = prev ?? st.order;
          const rawIndex = st.startIndex + Math.round(dy / st.itemHeight);
          const newIndex = Math.max(0, Math.min(st.order.length - 1, rawIndex));
          const curIndex = cur.indexOf(st.id);
          if (newIndex === curIndex) return prev;
          const before = new Map<string, DOMRect>();
          nodesRef.current.forEach((n, nid) => before.set(nid, n.getBoundingClientRect()));
          const next = cur.slice();
          next.splice(curIndex, 1);
          next.splice(newIndex, 0, st.id);
          requestAnimationFrame(() => flip(before));
          return next;
        });
      };

      const finish = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        const dragNode = nodesRef.current.get(id);
        if (dragNode) {
          dragNode.style.transition = 'transform 150ms ease';
          dragNode.style.transform = '';
          dragNode.style.zIndex = '';
        }
        const st = dragRef.current;
        dragRef.current = null;
        setDragId(null);
        setPreviewOrder((finalOrder) => {
          if (st && finalOrder && finalOrder.join('|') !== st.order.join('|')) {
            st.commit(finalOrder);
          }
          return null;
        });
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    },
    [],
  );

  return { dragId, previewOrder, setNodeRef, beginDrag };
}
