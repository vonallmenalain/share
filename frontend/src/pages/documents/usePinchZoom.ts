import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
/** Zoomstufe beim Doppeltippen (aus der Ganzseiten-Ansicht). */
const DOUBLE_TAP_ZOOM = 2.5;

/** Punkt in einem Element, als Anteil von Breite/Höhe (bleibt beim Zoomen gleich). */
interface Anchor {
  el: HTMLElement;
  fx: number;
  fy: number;
}

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * Zoom innerhalb der Dokument-Ansicht: Zwei-Finger-Zoom und Doppeltippen, am
 * Computer Ctrl + Mausrad bzw. Trackpad. Statt die ganze Seite zu vergrössern
 * – dann liess sich auf dem Handy nur noch hoch und runter schieben, weil der
 * Scroll-Bereich die Geste übernahm – wird das Dokument selbst grösser, und
 * der Scroll-Container verschiebt es frei in alle Richtungen. Kopfzeile und
 * Player behalten ihre Grösse. Der Punkt unter den Fingern (bzw. dem
 * Mauszeiger) bleibt beim Zoomen an seinem Platz.
 *
 * `anchors` liefert die Elemente, an denen der Zoom ausgerichtet wird (z. B.
 * die PDF-Seiten). `zoom` ändert sich laufend während der Geste,
 * `settledZoom` erst, wenn sie kurz ruht – fürs scharfe Nachrendern.
 */
export function usePinchZoom(
  scrollEl: HTMLElement | null,
  anchors: () => HTMLElement[],
): { zoom: number; settledZoom: number } {
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [settledZoom, setSettledZoom] = useState(MIN_ZOOM);
  const zoomRef = useRef(MIN_ZOOM);
  const anchorsRef = useRef(anchors);
  anchorsRef.current = anchors;
  // Nach dem nächsten Neuzeichnen: dieser Punkt soll unter clientX/clientY liegen.
  const pending = useRef<(Anchor & { clientX: number; clientY: number }) | null>(null);

  /** Das nächstgelegene Anker-Element und die Position darin. */
  const anchorAt = useCallback((clientX: number, clientY: number): Anchor | null => {
    let best: { el: HTMLElement; rect: DOMRect; dist: number } | null = null;
    for (const el of anchorsRef.current()) {
      const rect = el.getBoundingClientRect();
      const dist =
        clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      if (!best || dist < best.dist) best = { el, rect, dist };
      if (dist === 0) break;
    }
    if (!best || !best.rect.width || !best.rect.height) return null;
    return {
      el: best.el,
      fx: (clientX - best.rect.left) / best.rect.width,
      fy: (clientY - best.rect.top) / best.rect.height,
    };
  }, []);

  const zoomTo = useCallback(
    (next: number, anchor: Anchor | null, clientX: number, clientY: number) => {
      const z = clampZoom(next);
      if (Math.abs(z - zoomRef.current) < 0.0005) return;
      zoomRef.current = z;
      pending.current = anchor ? { ...anchor, clientX, clientY } : null;
      setZoom(z);
    },
    [],
  );

  // Nach dem Neuzeichnen in der neuen Grösse den verankerten Punkt wieder
  // unter Finger bzw. Mauszeiger schieben (an den Rändern begrenzt der Browser).
  useLayoutEffect(() => {
    const p = pending.current;
    pending.current = null;
    if (!p || !scrollEl || !p.el.isConnected) return;
    const rect = p.el.getBoundingClientRect();
    scrollEl.scrollLeft += rect.left + p.fx * rect.width - p.clientX;
    scrollEl.scrollTop += rect.top + p.fy * rect.height - p.clientY;
  }, [zoom, scrollEl]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledZoom(zoom), 180);
    return () => window.clearTimeout(timer);
  }, [zoom]);

  useEffect(() => {
    const el = scrollEl;
    if (!el) return;

    // Höchstens eine Zoom-Änderung pro Bild.
    let frame = 0;
    let queued: (() => void) | null = null;
    const schedule = (fn: () => void) => {
      queued = fn;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const run = queued;
        queued = null;
        run?.();
      });
    };

    let animation = 0;
    const animateTo = (target: number, x: number, y: number) => {
      cancelAnimationFrame(animation);
      const from = zoomRef.current;
      const anchor = anchorAt(x, y);
      const start = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / 220);
        const eased = 1 - (1 - k) ** 3;
        zoomTo(from + (target - from) * eased, anchor, x, y);
        if (k < 1) animation = requestAnimationFrame(step);
      };
      animation = requestAnimationFrame(step);
    };

    // ---- Touch: zwei Finger zoomen, Doppeltippen ----------------------------
    let touchesDown = 0;
    let pinch: { d0: number; z0: number; anchor: Anchor | null } | null = null;
    let tap: { x: number; y: number; t: number; moved: boolean } | null = null;
    let lastTap: { x: number; y: number; t: number } | null = null;
    const distance = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const middle = (t: TouchList) => ({
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2,
    });

    const onTouchStart = (e: TouchEvent) => {
      touchesDown = e.touches.length;
      if (e.touches.length >= 2) {
        cancelAnimationFrame(animation);
        const m = middle(e.touches);
        pinch = { d0: distance(e.touches) || 1, z0: zoomRef.current, anchor: anchorAt(m.x, m.y) };
        tap = null;
        lastTap = null;
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        tap = { x: t.clientX, y: t.clientY, t: Date.now(), moved: false };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (pinch && e.touches.length >= 2) {
        // Nicht die ganze Seite zoomen lassen – das übernimmt die Ansicht.
        if (e.cancelable) e.preventDefault();
        const { d0, z0, anchor } = pinch;
        const d = distance(e.touches);
        const m = middle(e.touches);
        schedule(() => zoomTo(z0 * (d / d0), anchor, m.x, m.y));
        return;
      }
      if (tap && e.touches.length === 1) {
        const t = e.touches[0];
        if (Math.hypot(t.clientX - tap.x, t.clientY - tap.y) > 10) tap.moved = true;
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      touchesDown = e.touches.length;
      if (pinch) {
        if (e.touches.length < 2) pinch = null;
        tap = null;
        return;
      }
      if (!tap || e.touches.length > 0) return;
      const now = Date.now();
      const { x, y } = tap;
      const isTap = e.type === 'touchend' && !tap.moved && now - tap.t < 300;
      tap = null;
      if (!isTap) {
        lastTap = null;
        return;
      }
      if (lastTap && now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30) {
        lastTap = null;
        if (e.cancelable) e.preventDefault();
        // Doppeltippen: hinein an diese Stelle bzw. zurück auf die ganze Seite.
        animateTo(zoomRef.current > 1.05 ? MIN_ZOOM : DOUBLE_TAP_ZOOM, x, y);
      } else {
        lastTap = { x, y, t: now };
      }
    };

    // ---- Computer: Ctrl + Mausrad, Trackpad-Zoom ----------------------------
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // normales Scrollen
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const factor = Math.exp(-Math.max(-60, Math.min(60, delta)) / 160);
      const { clientX: x, clientY: y } = e;
      zoomTo(zoomRef.current * factor, anchorAt(x, y), x, y);
    };

    // Safari: Trackpad-Zoom kommt als „gesture"-Ereignis. Auf iPhone/iPad
    // laufen diese parallel zu den Touch-Ereignissen – dort nur das Zoomen
    // der ganzen Seite verhindern.
    type GestureLike = Event & { scale?: number; clientX?: number; clientY?: number };
    let gesture: { z0: number; anchor: Anchor | null; x: number; y: number } | null = null;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      if (touchesDown > 0 || pinch) return;
      const g = e as GestureLike;
      const rect = el.getBoundingClientRect();
      const x = g.clientX ?? rect.left + rect.width / 2;
      const y = g.clientY ?? rect.top + rect.height / 2;
      gesture = { z0: zoomRef.current, anchor: anchorAt(x, y), x, y };
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (!gesture) return;
      const g = gesture;
      const scale = (e as GestureLike).scale ?? 1;
      schedule(() => zoomTo(g.z0 * scale, g.anchor, g.x, g.y));
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gesture = null;
    };

    const active = { passive: false } as AddEventListenerOptions;
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, active);
    el.addEventListener('touchend', onTouchEnd, active);
    el.addEventListener('touchcancel', onTouchEnd);
    el.addEventListener('wheel', onWheel, active);
    el.addEventListener('gesturestart', onGestureStart, active);
    el.addEventListener('gesturechange', onGestureChange, active);
    el.addEventListener('gestureend', onGestureEnd, active);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(animation);
    };
  }, [scrollEl, anchorAt, zoomTo]);

  return { zoom, settledZoom };
}
