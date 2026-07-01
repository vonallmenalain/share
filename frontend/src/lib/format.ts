export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Übertragungsrate als „12.3 MB/s“ (bzw. KB/s bei kleinen Werten). */
export function formatSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '–';
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** Grobe Restdauer als „~2 Min. 30 Sek.“ / „~45 Sek.“. */
export function formatEta(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '–';
  const s = Math.round(seconds);
  if (s < 60) return `~${s} Sek.`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `~${m} Min. ${rem} Sek.` : `~${m} Min.`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM ? `~${h} Std. ${remM} Min.` : `~${h} Std.`;
}

export function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '';
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('de-CH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Gruppiert nach Tag (YYYY-MM-DD) anhand takenAt (Fallback createdAt). */
export function dayKey(iso: string | null, fallback: string): string {
  const src = iso || fallback;
  const d = new Date(src);
  if (Number.isNaN(d.getTime())) return 'Unbekannt';
  return d.toISOString().slice(0, 10);
}

export function formatDayHeading(key: string): string {
  if (key === 'Unbekannt') return 'Ohne Datum';
  const d = new Date(`${key}T12:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString('de-CH', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}
