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

/**
 * Formatiert einen Geldbetrag, der als ganzzahlige Rappen/Cents vorliegt, für
 * die Anzeige. Es wird KEINE Geldrechnung mit Fliesskommazahlen durchgeführt –
 * lediglich die Anzeige teilt durch 100. Nutzt `Intl.NumberFormat`.
 */
export function formatMoney(cents: number, currency = 'CHF'): string {
  const value = cents / 100;
  try {
    return new Intl.NumberFormat('de-CH', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

/** Wandelt eine Benutzereingabe (z. B. "74.50") in ganzzahlige Rappen um. */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[^0-9.,-]/g, '').replace(/,/g, '.');
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  // Auf Rappen runden und als Ganzzahl zurückgeben.
  return Math.round(value * 100);
}

/** Formatiert Rappen ohne Währungssymbol für Eingabefelder (z. B. "74.50"). */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Formatiert einen ISO-Zeitstempel als Datum + Uhrzeit.
 *
 * `floating`: Foto-Aufnahmezeiten stammen aus EXIF und sind reine Wanduhrzeiten
 * ohne Zeitzone. Sie werden im Backend als UTC kodiert und müssen hier ohne
 * Zeitzonen-Umrechnung (also in UTC) angezeigt werden – sonst wäre die Uhrzeit
 * je nach Betrachter-Zeitzone verschoben (z. B. 08:00 → 10:00). Echte Zeitpunkte
 * (z. B. Upload-Zeit) werden weiterhin in der lokalen Zeitzone dargestellt.
 */
export function formatDateTime(iso: string | null, opts?: { floating?: boolean }): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('de-CH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(opts?.floating ? { timeZone: 'UTC' } : {}),
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
