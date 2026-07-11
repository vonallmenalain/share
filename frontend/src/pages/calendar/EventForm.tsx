import { useState } from 'react';
import { api, CalendarEvent } from '../../api/client';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Zerlegt einen ISO-Zeitstempel in lokale Datums- und Zeitkomponenten. */
function isoToLocal(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Baut aus lokalem Datum + Uhrzeit einen ISO-Zeitstempel. */
function localToIso(date: string, time: string): string | null {
  if (!date) return null;
  const d = new Date(`${date}T${time || '00:00'}`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Addiert Minuten auf eine „HH:MM"-Uhrzeit (rollt über Mitternacht). */
function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = (((h * 60 + m + minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

const DURATION_PRESETS: { label: string; minutes: number }[] = [
  { label: '30 Min.', minutes: 30 },
  { label: '1 Std.', minutes: 60 },
  { label: '1½ Std.', minutes: 90 },
  { label: '2 Std.', minutes: 120 },
];

export default function EventForm({
  token,
  participantId,
  editing,
  defaultDate,
  onClose,
  onSaved,
}: {
  token: string;
  participantId?: string;
  editing: CalendarEvent | null;
  defaultDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const start = editing ? isoToLocal(editing.startAt) : { date: defaultDate, time: '09:00' };
  const end = editing ? isoToLocal(editing.endAt) : { date: '', time: '' };

  const [title, setTitle] = useState(editing?.title ?? '');
  const [allDay, setAllDay] = useState(editing?.allDay ?? false);
  const [date, setDate] = useState(editing?.allDay ? editing.allDayDate ?? defaultDate : start.date || defaultDate);
  const [startTime, setStartTime] = useState(start.time || '09:00');
  const [endDate, setEndDate] = useState(editing?.allDay ? editing.endAt ?? '' : end.date);
  const [endTime, setEndTime] = useState(end.time);
  const [location, setLocation] = useState(editing?.location ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /** Beim Ändern der Startzeit die Endzeit mitverschieben, sofern sie noch
   * nicht eigenständig verändert wurde (bzw. leer ist) – so bleibt eine
   * einmal gewählte Dauer erhalten, ohne dass man die Endzeit von Hand
   * nachziehen muss. */
  const handleStartTimeChange = (value: string) => {
    if (endTime && startTime) {
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      const durationMin = eh * 60 + em - (sh * 60 + sm);
      if (durationMin > 0) {
        setEndTime(addMinutesToTime(value, durationMin));
      }
    }
    setStartTime(value);
  };

  const applyDuration = (minutes: number) => {
    setEndTime(addMinutesToTime(startTime, minutes));
    if (!endDate) setEndDate(date);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!title.trim()) return setError('Bitte einen Titel angeben.');
    if (!date) return setError('Bitte ein Datum angeben.');

    const body: Record<string, unknown> = {
      title: title.trim(),
      location: location.trim() || undefined,
      description: description.trim() || undefined,
      allDay,
    };
    if (allDay) {
      body.allDayDate = date;
      body.endAt = endDate || undefined;
    } else {
      const startIso = localToIso(date, startTime);
      if (!startIso) return setError('Ungültige Startzeit.');
      body.startAt = startIso;
      if (endTime) {
        const endIso = localToIso(endDate || date, endTime);
        if (endIso) body.endAt = endIso;
      }
    }

    setBusy(true);
    try {
      if (editing) {
        await api(`/api/calendar/events/${editing.id}`, {
          method: 'PATCH',
          token,
          participantId,
          body,
        });
      } else {
        await api('/api/calendar/events', { method: 'POST', token, participantId, body });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{editing ? 'Termin bearbeiten' : 'Termin hinzufügen'}</h2>
          <button className="btn icon-btn btn-ghost" onClick={onClose} aria-label="Schliessen">
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="modal-body">
          {error && <div className="error-box">{error}</div>}

          <div className="field">
            <label className="label">Titel</label>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="z. B. Bootsfahrt"
              autoFocus
            />
          </div>

          <label className="checkbox-line">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            Ganztägig
          </label>

          {allDay ? (
            <div className="form-row">
              <div className="field" style={{ flex: 1 }}>
                <label className="label">Datum</label>
                <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="label">Ende (optional)</label>
                <input
                  className="input"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <>
              <div className="form-row">
                <div className="field" style={{ flex: 2 }}>
                  <label className="label">Datum</label>
                  <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label className="label">Von</label>
                  <input
                    className="input"
                    type="time"
                    step={900}
                    value={startTime}
                    onChange={(e) => handleStartTimeChange(e.target.value)}
                  />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label className="label">Bis</label>
                  <input
                    className="input"
                    type="time"
                    step={900}
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </div>
              <div className="field duration-chips">
                <label className="label">Dauer</label>
                <div className="chip-row">
                  {DURATION_PRESETS.map((p) => (
                    <button
                      type="button"
                      key={p.minutes}
                      className="duration-chip"
                      onClick={() => applyDuration(p.minutes)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="field">
            <label className="label">Ort (optional)</label>
            <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>

          <div className="field">
            <label className="label">Beschreibung (optional)</label>
            <textarea
              className="input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Abbrechen
            </button>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Speichere…' : editing ? 'Speichern' : 'Hinzufügen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
