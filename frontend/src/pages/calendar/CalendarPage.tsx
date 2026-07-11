import { useCallback, useMemo, useState } from 'react';
import { api, CalendarEvent } from '../../api/client';
import { useSpaceSessionContext } from '../../context/SpaceSessionContext';
import { useModuleData } from '../../lib/useModuleData';
import { useParticipants } from '../../lib/useParticipants';
import { calendarViewStore, CalendarViewMode } from '../../lib/storage';
import EventForm from './EventForm';
import {
  WEEKDAYS,
  addDays,
  addMonths,
  dayLabel,
  eventChipLabel,
  eventDay,
  eventTimeLabel,
  monthGridWeeks,
  monthLabel,
  parseKey,
  sortDayEvents,
  startOfWeek,
  todayKey,
  weekDays,
  weekLabel,
} from './dateUtils';

const MONTH_CHIP_LIMIT = 2;
const WEEK_CHIP_LIMIT = 4;

export default function CalendarPage() {
  const { slug, token } = useSpaceSessionContext();
  const { currentId } = useParticipants(slug, token);
  const participantId = currentId ?? undefined;

  const today = todayKey();
  const [viewMode, setViewMode] = useState<CalendarViewMode>(() => calendarViewStore.get());
  const [focusDate, setFocusDate] = useState(today);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);

  const changeView = (mode: CalendarViewMode) => {
    setViewMode(mode);
    calendarViewStore.set(mode);
  };

  const focusParts = useMemo(() => {
    const d = parseKey(focusDate);
    return { year: d.getFullYear(), month: d.getMonth() };
  }, [focusDate]);

  const weekStart = useMemo(() => startOfWeek(focusDate), [focusDate]);
  const gridWeeks = useMemo(
    () => (viewMode === 'month' ? monthGridWeeks(focusParts.year, focusParts.month) : [weekDays(weekStart)]),
    [viewMode, focusParts.year, focusParts.month, weekStart],
  );

  const range = useMemo(
    () => ({ from: gridWeeks[0][0], to: gridWeeks[gridWeeks.length - 1][6] }),
    [gridWeeks],
  );

  const load = useCallback(
    async (signal: AbortSignal) => {
      const res = await api<{ events: CalendarEvent[] }>(
        `/api/calendar/events?from=${range.from}&to=${range.to}`,
        { token, signal },
      );
      return res.events;
    },
    [token, range.from, range.to],
  );

  const { data, loading, reload } = useModuleData<CalendarEvent[]>(load, [token, range.from, range.to], {
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

  const goPrev = () => setFocusDate((d) => (viewMode === 'day' ? addDays(d, -1) : viewMode === 'week' ? addDays(d, -7) : addMonths(d, -1)));
  const goNext = () => setFocusDate((d) => (viewMode === 'day' ? addDays(d, 1) : viewMode === 'week' ? addDays(d, 7) : addMonths(d, 1)));
  const goToday = () => setFocusDate(today);

  const toolbarLabel =
    viewMode === 'day' ? dayLabel(focusDate) : viewMode === 'week' ? weekLabel(weekStart) : monthLabel(focusParts.year, focusParts.month);

  const dayEvents = sortDayEvents(eventsByDay.get(focusDate) ?? []);

  const deleteEvent = async (ev: CalendarEvent) => {
    if (!confirm('Diesen Termin löschen?')) return;
    try {
      await api(`/api/calendar/events/${ev.id}`, { method: 'DELETE', token, participantId });
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
    }
  };

  const renderDayCell = (day: string, opts: { chipLimit: number; dimmed?: boolean }) => {
    const has = sortDayEvents(eventsByDay.get(day) ?? []);
    const visible = has.slice(0, opts.chipLimit);
    const overflow = has.length - visible.length;
    const isSelected = day === focusDate;
    const isToday = day === today;
    const dayNum = parseKey(day).getDate();
    return (
      <button
        key={day}
        type="button"
        className={`calendar-cell${isSelected ? ' selected' : ''}${isToday ? ' today' : ''}${opts.dimmed ? ' dimmed' : ''}`}
        onClick={() => setFocusDate(day)}
      >
        <span className="calendar-cell-daynum">{dayNum}</span>
        {has.length > 0 && (
          <span className="calendar-cell-chips">
            {visible.map((ev) => (
              <span key={ev.id} className={`cal-chip${ev.allDay ? ' allday' : ''}`}>
                {eventChipLabel(ev)}
              </span>
            ))}
            {overflow > 0 && <span className="cal-chip-more">+{overflow} weitere</span>}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="container module-page">
      <div className="module-head">
        <h1 className="space-title">Kalender</h1>
        <div className="spacer" />
        <div className="segmented sm calendar-view-switch" role="tablist" aria-label="Ansicht wählen">
          <button type="button" className={viewMode === 'day' ? 'active' : ''} onClick={() => changeView('day')}>
            Tag
          </button>
          <button type="button" className={viewMode === 'week' ? 'active' : ''} onClick={() => changeView('week')}>
            Woche
          </button>
          <button type="button" className={viewMode === 'month' ? 'active' : ''} onClick={() => changeView('month')}>
            Monat
          </button>
        </div>
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

      <div className="calendar-toolbar">
        <div className="calendar-toolbar-nav">
          <button className="btn btn-sm btn-ghost" onClick={goPrev} aria-label="Zurück">
            ‹
          </button>
          <button className="btn btn-sm btn-ghost" onClick={goToday}>
            Heute
          </button>
          <button className="btn btn-sm btn-ghost" onClick={goNext} aria-label="Weiter">
            ›
          </button>
        </div>
        <strong className="calendar-toolbar-label">{toolbarLabel}</strong>
        {loading && <span className="spinner" />}
      </div>

      <div className="calendar-agenda card">
        <h3 style={{ marginTop: 0 }}>{dayLabel(focusDate)}</h3>
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

      {viewMode !== 'day' && (
        <div className="calendar-card card">
          <div className={`calendar-grid view-${viewMode}`}>
            {WEEKDAYS.map((w) => (
              <div key={w} className="calendar-weekday">
                {w}
              </div>
            ))}
            {gridWeeks.flat().map((day) =>
              renderDayCell(day, {
                chipLimit: viewMode === 'week' ? WEEK_CHIP_LIMIT : MONTH_CHIP_LIMIT,
                dimmed: viewMode === 'month' && parseKey(day).getMonth() !== focusParts.month,
              }),
            )}
          </div>
        </div>
      )}

      {viewMode === 'day' && (
        <div className="calendar-card card">
          <div className="calendar-daystrip">
            {weekDays(weekStart).map((day) => {
              const has = eventsByDay.get(day)?.length ?? 0;
              const isSelected = day === focusDate;
              const isToday = day === today;
              const d = parseKey(day);
              return (
                <button
                  key={day}
                  type="button"
                  className={`calendar-strip-cell${isSelected ? ' selected' : ''}${isToday ? ' today' : ''}`}
                  onClick={() => setFocusDate(day)}
                >
                  <span className="calendar-strip-weekday">{WEEKDAYS[(d.getDay() + 6) % 7]}</span>
                  <span className="calendar-strip-daynum">{d.getDate()}</span>
                  {has > 0 && <span className="calendar-dot" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {showForm && (
        <EventForm
          token={token}
          participantId={participantId}
          editing={editing}
          defaultDate={focusDate}
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
