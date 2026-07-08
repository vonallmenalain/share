interface Props {
  size?: number;
  className?: string;
}

/**
 * Dezentes „Login"-/Personen-Symbol (Kopf + Schultern). Steht im Bereich für
 * den aktuell gewählten Namen – ein echtes Login gibt es nicht.
 */
export default function UserIcon({ size = 20, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
