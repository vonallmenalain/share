/**
 * Das Zeichen des alae.app-Logos (zwei Chevrons, Pfade aus dem Logo-Paket).
 * Der linke Chevron folgt der Textfarbe (`currentColor` – dunkel auf hellem,
 * hell auf dunklem Grund), der rechte ist immer im Logo-Rot.
 */
export default function AlaeMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="60 40 1000 532" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M65.03 509.42L294.2 82.33A42.36 42.36 0 0 1 368.85 82.33L483.44 295.87A42.36 42.36 0 0 1 466.14 353.23A42.36 42.36 0 0 1 408.78 335.93L331.53 191.95L139.69 549.47A42.36 42.36 0 0 1 82.33 566.77A42.36 42.36 0 0 1 65.03 509.42Z"
      />
      <path
        fill="#fe7971"
        d="M521.98 509.42L751.15 82.33A42.36 42.36 0 0 1 825.8 82.33L1054.97 509.42A42.36 42.36 0 0 1 1037.67 566.77A42.36 42.36 0 0 1 980.31 549.47L788.47 191.95L596.63 549.47A42.36 42.36 0 0 1 539.28 566.77A42.36 42.36 0 0 1 521.98 509.42Z"
      />
    </svg>
  );
}
