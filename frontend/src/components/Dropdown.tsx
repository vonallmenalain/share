import { ReactNode, useEffect, useRef, useState } from 'react';

interface Props {
  /** Inhalt der auslösenden Schaltfläche (z. B. Icon oder Text + Chevron). */
  label: ReactNode;
  /** Zusätzliche Klassen für die auslösende Schaltfläche. */
  triggerClassName?: string;
  /** Vorlesetext für reine Icon-Buttons. */
  ariaLabel?: string;
  title?: string;
  /** Ausrichtung des Menüs relativ zum Auslöser. */
  align?: 'start' | 'end';
  /**
   * Menü-Inhalt. Die übergebene `close`-Funktion schliesst das Menü – z. B.
   * nach der Auswahl eines Eintrags.
   */
  children: (close: () => void) => ReactNode;
}

/**
 * Kleines, wiederverwendbares Dropdown-Menü. Schliesst sich beim Klick nach
 * aussen oder mit Escape. Für mobile Optimierung reicht ein Fingertipp.
 */
export default function Dropdown({
  label,
  triggerClassName,
  ariaLabel,
  title,
  align = 'start',
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="dropdown" ref={ref}>
      <button
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <div className={`dropdown-menu dropdown-${align}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
