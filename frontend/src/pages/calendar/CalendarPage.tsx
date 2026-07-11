import { useCallback, useMemo, useState } from 'react';
import { api, CalendarEvent } from '../../api/client';
import { useSpaceSessionContext } from '../../context/SpaceSessionContext';
import { useModuleData } from '../../lib/useModuleData';
import { useParticipants } from '../../lib/useParticipants';
import EventForm from './EventForm';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function dateKey(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}
/** Auf welchen (lokalen) Tag fällt ein Termin. */
function eventDay(ev: CalendarEvent): string {
  if (ev.allDay) return ev.allDayDate ?? '';
  if (!ev.startAt) return '';
  const d = new Date(ev.startAt);
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}
function eventTimeLabel(ev: CalendarEvent): string {
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

export default function CalendarPage() {
  const { slug, token } = useSpaceSessionContext();
  const { currentId } = useParticipants(slug, token);
  const participantId = currentId ?? undefined;

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState(dateKey(now.getFullYear(), now.getMonth(), now.getDate()));
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      // Grosszügiges Fenster um den Monat (für Übergänge zum Vor-/Folgemonat).
      const from = dateKey(year, month, 1);
      const toDate = new Date(year, month + 1, 0);
      const to = dateKey(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
      const res = await api<{ events: CalendarEvent[] }>(
        `/api/calendar/events?from=${from}&to=${to}`,
        { token, signal },
      );
      return res.events;
    },
    [token, year, month],
  );

  const { data, loading, reload } = useModuleData<CalendarEvent[]>(load, [token, year, month], {
    intervalMs: 15000,
  });
  const events = data ?? [];

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const key = eventDay(ev);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return map;
  }, [events]);

  // Kalendergitter (Wochen Mo–So).
  const weeks = useMemo(() => {
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7; // Mo=0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    const rows: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [year, month]);

  const changeMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  };

  const todayKey = dateKey(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEvents = (eventsByDay.get(selectedDay) ?? []).sort((a, b) => {
    if (a.allDay && !b.allDay) return -1;
    if (!a.allDay && b.allDay) return 1;
    return (a.startAt ?? '').localeCompare(b.startAt ?? '');
  });

  const deleteEvent = async (ev: CalendarEvent) => {
    if (!confirm('Diesen Termin löschen?')) return;
    try {
      await api(`/api/calendar/events/${ev.id}`, { method: 'DELETE', token, participantId });
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
    }
  };

  return (
    <div className="container module-page">
      <div className="module-head">
        <h1 className="space-title">Kalender</h1>
        <div className="spacer" />
        <button
          className="btn btn-sm btn-primary"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          + Termin
        </button>
      </div>

      <div className="calendar-card card">
        <div className="calendar-nav">
          <button className="btn btn-sm btn-ghost" onClick={() => changeMonth(-1)} aria-label="Vorheriger Monat">
            ‹
          </button>
          <strong>
            {MONTHS[month]} {year}
          </strong>
          <button className="btn btn-sm btn-ghost" onClick={() => changeMonth(1)} aria-label="Nächster Monat">
            ›
          </button>
          {loading && <span className="spinner" style={{ marginLeft: 8 }} />}
        </div>

        <div className="calendar-grid">
          {WEEKDAYS.map((w) => (
            <div key={w} className="calendar-weekday">
              {w}
            </div>
          ))}
          {weeks.flat().map((d, idx) => {
            if (d === null) return <div key={idx} className="calendar-cell empty" />;
            const key = dateKey(year, month, d);
            const has = eventsByDay.has(key);
            return (
              <button
                key={idx}
                className={`calendar-cell${key === selectedDay ? ' selected' : ''}${key === todayKey ? ' today' : ''}`}
                onClick={() => setSelectedDay(key)}
              >
                <span className="calendar-day-num">{d}</span>
                {has && <span className="calendar-dot" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="calendar-agenda card">
        <h3 style={{ marginTop: 0 }}>
          {new Date(`${selectedDay}T12:00:00`).toLocaleDateString('de-CH', {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
          })}
        </h3>
        {dayEvents.length === 0 ? (
          <p className="muted">Keine Termine an diesem Tag.</p>
        ) : (
          <ul className="agenda-list">
            {dayEvents.map((ev) => (
              <li key={ev.id} className="agenda-row">
                <div className="agenda-time">{eventTimeLabel(ev)}</div>
                <div className="agenda-main">
                  <strong>{ev.title}</strong>
                  {ev.location && <span className="muted"> · {ev.location}</span>}
                  {ev.description && <div className="agenda-desc">{ev.description}</div>}
                </div>
                <div className="agenda-actions">
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      setEditing(ev);
                      setShowForm(true);
                    }}
                  >
                    ✎
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => deleteEvent(ev)}>
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showForm && (
        <EventForm
          token={token}
          participantId={participantId}
          editing={editing}
          defaultDate={selectedDay}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            reload();
          }}
        />
      )}
    </div>
  );
}
