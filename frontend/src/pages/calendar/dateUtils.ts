import { CalendarEvent } from '../../api/client';

export const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Baut den lokalen Datumsschlüssel (YYYY-MM-DD) aus Jahr/Monat(0-basiert)/Tag. */
export function dateKey(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

/** Datumsschlüssel für „heute" (lokale Zeitzone). */
export function todayKey(): string {
  const n = new Date();
  return dateKey(n.getFullYear(), n.getMonth(), n.getDate());
}

/** Parst einen Datumsschlüssel als lokales Datum um die Mittagszeit (TZ-sicher). */
export function parseKey(key: string): Date {
  return new Date(`${key}T12:00:00`);
}

export function addDays(key: string, delta: number): string {
  const d = parseKey(key);
  d.setDate(d.getDate() + delta);
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addMonths(key: string, delta: number): string {
  const d = parseKey(key);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Montag der Woche, die den übergebenen Tag enthält. */
export function startOfWeek(key: string): string {
  const d = parseKey(key);
  const offset = (d.getDay() + 6) % 7; // Mo=0 ... So=6
  d.setDate(d.getDate() - offset);
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

export function weekDays(weekStartKey: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStartKey, i));
}

/** Alle Wochen (jeweils Montag als Schlüssel), die das Monatsraster einer
 * gegebenen Monatsansicht überdecken (inkl. Vor-/Nachmonat-Tagen). */
export function monthGridWeeks(year: number, month: number): string[][] {
  const first = dateKey(year, month, 1);
  const gridStart = startOfWeek(first);
  const lastOfMonth = new Date(year, month + 1, 0);
  const last = dateKey(lastOfMonth.getFullYear(), lastOfMonth.getMonth(), lastOfMonth.getDate());
  const gridEndWeekStart = startOfWeek(last);
  const weeks: string[][] = [];
  let cursor = gridStart;
  while (cursor <= gridEndWeekStart) {
    weeks.push(weekDays(cursor));
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

/** Auf welchen (lokalen) Tag fällt ein Termin. */
export function eventDay(ev: CalendarEvent): string {
  if (ev.allDay) return ev.allDayDate ?? '';
  if (!ev.startAt) return '';
  const d = new Date(ev.startAt);
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

export function eventStartTime(ev: CalendarEvent): string {
  if (ev.allDay || !ev.startAt) return '';
  return new Date(ev.startAt).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
}

export function eventTimeLabel(ev: CalendarEvent): string {
  if (ev.allDay) return 'Ganztägig';
  if (!ev.startAt) return '';
  const s = new Date(ev.startAt);
  const start = s.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
  if (ev.endAt) {
    const e = new Date(ev.endAt);
    return `${start}–${e.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return start;
}

/** Kurzer Chip-Text für die Kalenderübersicht, z. B. „09:00 Bootsfahrt". */
export function eventChipLabel(ev: CalendarEvent): string {
  if (ev.allDay) return ev.title;
  return `${eventStartTime(ev)} ${ev.title}`.trim();
}

export function sortDayEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => {
    if (a.allDay && !b.allDay) return -1;
    if (!a.allDay && b.allDay) return 1;
    return (a.startAt ?? '').localeCompare(b.startAt ?? '');
  });
}

export function dayLabel(key: string): string {
  return parseKey(key).toLocaleDateString('de-CH', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month]} ${year}`;
}

/** Beschriftung einer Woche, z. B. „13.–19. Juli 2026" oder „29. Juni – 5. Juli 2026". */
export function weekLabel(weekStartKey: string): string {
  const start = parseKey(weekStartKey);
  const end = parseKey(addDays(weekStartKey, 6));
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (sameMonth) {
    return `${start.getDate()}.–${end.getDate()}. ${MONTHS[start.getMonth()]} ${start.getFullYear()}`;
  }
  const sameYear = start.getFullYear() === end.getFullYear();
  const startPart = `${start.getDate()}. ${MONTHS[start.getMonth()]}${sameYear ? '' : ` ${start.getFullYear()}`}`;
  const endPart = `${end.getDate()}. ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
  return `${startPart} – ${endPart}`;
}
