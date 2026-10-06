import { DocType } from '../../api/client';

// Schlanke Strich-Icons (24×24, currentColor) für das Dokumente-Modul.

interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 20, className, children }: IconProps & { children: React.ReactNode }) {
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
      {children}
    </svg>
  );
}

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const PrevTrackIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 5v14L8 12z" fill="currentColor" stroke="none" />
    <rect x="5" y="5" width="2.6" height="14" rx="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const NextTrackIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 5v14l10-7z" fill="currentColor" stroke="none" />
    <rect x="16.4" y="5" width="2.6" height="14" rx="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
);

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />
  </Svg>
);

export const UploadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 19V8M7 12.5l5-5 5 5M5 4.5h14" />
  </Svg>
);

export const LinkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
  </Svg>
);

export const EditIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
    <path d="M13.5 6.5l4 4" />
  </Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7" />
  </Svg>
);

export const ArrowUpIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
);

export const ArrowDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
);

export const RestoreIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v5h5" />
  </Svg>
);

/** Typ-Symbol in einem farbigen, abgerundeten Quadrat (Listen-Icon). */
export function DocTypeBadge({ type }: { type: DocType }) {
  return (
    <span className={`doc-badge doc-badge-${type}`} aria-hidden="true">
      {type === 'pdf' ? (
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinejoin="round"
        >
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v4h4" />
          <text
            x="12"
            y="17.2"
            textAnchor="middle"
            fontSize="5.6"
            fontWeight="800"
            fill="currentColor"
            stroke="none"
            fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
          >
            PDF
          </text>
        </svg>
      ) : type === 'audio' ? (
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 17.5V5.5l10-2v12" />
          <circle cx="6.5" cy="17.5" r="2.5" fill="currentColor" />
          <circle cx="16.5" cy="15.5" r="2.5" fill="currentColor" />
        </svg>
      ) : type === 'image' ? (
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinejoin="round"
        >
          <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
          <circle cx="9" cy="10" r="1.8" fill="currentColor" stroke="none" />
          <path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4" />
        </svg>
      ) : type === 'video' ? (
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinejoin="round"
        >
          <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
          <path d="M10.5 9.2v5.6l4.6-2.8z" fill="currentColor" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinejoin="round"
        >
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v4h4M9 12h6M9 15.5h6" />
        </svg>
      )}
    </span>
  );
}

/** Kleine, animierte Balken für „spielt gerade". */
export function PlayingBars() {
  return (
    <span className="doc-playing-bars" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
