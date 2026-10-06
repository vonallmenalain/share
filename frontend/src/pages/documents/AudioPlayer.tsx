import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { DocumentItem } from '../../api/client';
import { docTitle, formatClock, viewUrl } from './docUtils';
import {
  ChevronUpIcon,
  CloseIcon,
  NextTrackIcon,
  PauseIcon,
  PlayIcon,
  PlayingBars,
  PrevTrackIcon,
} from './icons';

export interface AudioPlayer {
  /** Das zu rendernde <audio>-Element (eines für die ganze Wiedergabeliste). */
  audioRef: RefObject<HTMLAudioElement>;
  currentId: string | null;
  playing: boolean;
  loading: boolean;
  error: string;
  /** Spielt ein Lied ab – oder pausiert/setzt fort, wenn es schon läuft. */
  playOrToggle: (id: string) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  pause: () => void;
  stop: () => void;
}

/**
 * Wiedergabeliste für die Audio-Dokumente: ein Klick spielt sofort ab, am Ende
 * eines Liedes startet automatisch das nächste (nach dem letzten ist Schluss).
 * Bewusst EIN <audio>-Element für alle Lieder: So darf der Browser (auch auf
 * dem iPhone) nach dem ersten Antippen weitere Lieder ohne erneutes Tippen
 * starten – auch bei gesperrtem Bildschirm.
 */
export function useAudioPlayer(
  tracks: DocumentItem[],
  token: string,
  albumName: string,
): AudioPlayer {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Immer die aktuellen Werte in den (einmalig registrierten) Event-Handlern.
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const currentRef = useRef<string | null>(null);

  const load = useCallback((id: string) => {
    const audio = audioRef.current;
    const track = tracksRef.current.find((t) => t.id === id);
    if (!audio || !track) return;
    currentRef.current = id;
    setCurrentId(id);
    setError('');
    setLoading(true);
    audio.src = viewUrl(track, tokenRef.current);
    const started = audio.play();
    if (started) {
      started.catch((err: unknown) => {
        // Abbruch durch ein schnell gewähltes anderes Lied ist kein Fehler.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLoading(false);
        setPlaying(false);
      });
    }
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentRef.current) return;
    if (audio.paused) {
      if (audio.ended) audio.currentTime = 0;
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, []);

  const playOrToggle = useCallback(
    (id: string) => {
      if (currentRef.current === id) toggle();
      else load(id);
    },
    [load, toggle],
  );

  const next = useCallback(() => {
    const list = tracksRef.current;
    const i = list.findIndex((t) => t.id === currentRef.current);
    if (i >= 0 && i < list.length - 1) load(list[i + 1].id);
  }, [load]);

  const prev = useCallback(() => {
    const audio = audioRef.current;
    const list = tracksRef.current;
    const i = list.findIndex((t) => t.id === currentRef.current);
    // Wie gewohnt: nach den ersten Sekunden springt „zurück" an den Anfang.
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    if (i > 0) load(list[i - 1].id);
    else if (audio) audio.currentTime = 0;
  }, [load]);

  const pause = useCallback(() => audioRef.current?.pause(), []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    currentRef.current = null;
    setCurrentId(null);
    setPlaying(false);
    setLoading(false);
    setError('');
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onWaiting = () => setLoading(true);
    const onReady = () => setLoading(false);
    const onEnded = () => {
      const list = tracksRef.current;
      const i = list.findIndex((t) => t.id === currentRef.current);
      // Am Ende automatisch das nächste Lied – nach dem letzten ist Schluss.
      if (i >= 0 && i < list.length - 1) load(list[i + 1].id);
      else setPlaying(false);
    };
    const onError = () => {
      if (!currentRef.current || !audio.getAttribute('src')) return;
      setLoading(false);
      setPlaying(false);
      setError('Diese Datei kann hier nicht abgespielt werden.');
    };
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onReady);
    audio.addEventListener('canplay', onReady);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onReady);
      audio.removeEventListener('canplay', onReady);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.pause();
    };
  }, [load]);

  // Sperrbildschirm / Kopfhörer-Tasten / Steuerzentrale (Media Session).
  const current = tracks.find((t) => t.id === currentId) ?? null;
  const currentTitle = current ? docTitle(current) : '';
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    if (!currentTitle) {
      ms.metadata = null;
      return;
    }
    try {
      ms.metadata = new MediaMetadata({ title: currentTitle, artist: albumName });
    } catch {
      /* ältere Browser */
    }
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => void audioRef.current?.play().catch(() => undefined)],
      ['pause', () => audioRef.current?.pause()],
      ['previoustrack', prev],
      ['nexttrack', next],
      [
        'seekto',
        (details) => {
          const audio = audioRef.current;
          if (audio && details.seekTime != null) audio.currentTime = details.seekTime;
        },
      ],
    ];
    for (const [action, handler] of handlers) {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* Aktion wird nicht unterstützt */
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          /* ignore */
        }
      }
    };
  }, [currentTitle, albumName, next, prev]);

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = currentId ? (playing ? 'playing' : 'paused') : 'none';
    }
  }, [playing, currentId]);

  return {
    audioRef,
    currentId,
    playing,
    loading,
    error,
    playOrToggle,
    toggle,
    next,
    prev,
    pause,
    stop,
  };
}

/**
 * Schlanke Player-Leiste am unteren Rand: Titel, Zeit, Fortschritt zum
 * Spulen, zurück / Play-Pause / weiter. Bleibt auch über der PDF-Ansicht
 * sichtbar – so lassen sich Noten oder Texte lesen, während das Lied läuft.
 * Ein Tippen auf den Titel (bzw. den Pfeil daneben) klappt die Playlist nach
 * oben auf: Dort lässt sich jedes Lied direkt wählen, ohne die Ansicht zu
 * verlassen.
 */
export function PlayerBar({ player, tracks }: { player: AudioPlayer; tracks: DocumentItem[] }) {
  const track = tracks.find((t) => t.id === player.currentId) ?? null;
  const audio = player.audioRef.current;
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(track?.duration ?? 0);
  // Während des Ziehens am Fortschrittsbalken nur anzeigen, erst beim
  // Loslassen springen (spart unnötige Nachlade-Anfragen).
  const [scrub, setScrub] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    setDuration(track?.duration ?? 0);
    setTime(0);
  }, [track?.id, track?.duration]);

  // Wiedergabe beendet → Playlist wieder zuklappen.
  useEffect(() => {
    if (!player.currentId) setExpanded(false);
  }, [player.currentId]);

  // Aufgeklappt: das laufende Lied sichtbar machen; Escape klappt zu (vor
  // allen anderen Tasten-Aktionen, z. B. dem Schliessen der PDF-Ansicht).
  useEffect(() => {
    if (!expanded) return;
    listRef.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest' });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setExpanded(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [expanded]);

  useEffect(() => {
    if (!audio) return;
    const onTime = () => setTime(audio.currentTime);
    const onDuration = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    };
    onTime();
    onDuration();
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('seeked', onTime);
    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('loadedmetadata', onDuration);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('seeked', onTime);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('loadedmetadata', onDuration);
    };
  }, [audio, player.currentId]);

  if (!track) return null;
  const index = tracks.findIndex((t) => t.id === track.id);
  const shown = scrub ?? time;
  const max = duration > 0 ? duration : Math.max(shown, 1);
  const percent = Math.min(100, (shown / max) * 100);

  const commit = () => {
    if (scrub == null) return;
    if (audio) audio.currentTime = scrub;
    setTime(scrub);
    setScrub(null);
  };

  const choose = (id: string) => {
    player.playOrToggle(id);
    setExpanded(false);
  };

  return (
    <>
      {expanded && <div className="doc-player-backdrop" onClick={() => setExpanded(false)} />}
      <div
        className={`doc-player${expanded ? ' expanded' : ''}`}
        role="region"
        aria-label="Musik-Wiedergabe"
      >
        {expanded && (
          <div className="doc-player-list" id="doc-player-list">
            <div className="doc-player-list-head">
              Playlist · {tracks.length} {tracks.length === 1 ? 'Lied' : 'Lieder'}
            </div>
            <ol ref={listRef}>
              {tracks.map((t, i) => {
                const isCurrent = t.id === track.id;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      className={`doc-player-track${isCurrent ? ' current' : ''}`}
                      aria-current={isCurrent ? 'true' : undefined}
                      onClick={() => choose(t.id)}
                    >
                      <span className="doc-player-track-no">
                        {isCurrent && player.playing ? <PlayingBars /> : i + 1}
                      </span>
                      <span className="doc-player-track-name">{docTitle(t)}</span>
                      {t.duration ? (
                        <span className="doc-player-track-time">{formatClock(t.duration)}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
        <input
          type="range"
          className="doc-player-seek"
          min={0}
          max={max}
          step={0.1}
          value={shown}
          style={{ '--progress': `${percent}%` } as React.CSSProperties}
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={commit}
          onTouchEnd={commit}
          onKeyUp={commit}
          onBlur={commit}
          aria-label="Position im Lied"
          aria-valuetext={`${formatClock(shown)} von ${formatClock(duration)}`}
        />
        <div className="doc-player-row">
          <button
            className="doc-player-btn"
            onClick={player.prev}
            aria-label="Vorheriges Lied"
            title="Vorheriges Lied"
          >
            <PrevTrackIcon size={20} />
          </button>
          <button
            className="doc-player-btn doc-player-main"
            onClick={player.toggle}
            aria-label={player.playing ? 'Pause' : 'Abspielen'}
            title={player.playing ? 'Pause' : 'Abspielen'}
          >
            {player.loading && player.playing ? (
              <span className="spinner white" />
            ) : player.playing ? (
              <PauseIcon size={22} />
            ) : (
              <PlayIcon size={22} />
            )}
          </button>
          <button
            className="doc-player-btn"
            onClick={player.next}
            disabled={index < 0 || index >= tracks.length - 1}
            aria-label="Nächstes Lied"
            title="Nächstes Lied"
          >
            <NextTrackIcon size={20} />
          </button>
          <button
            type="button"
            className="doc-player-info"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls="doc-player-list"
            title={expanded ? 'Playlist zuklappen' : 'Playlist anzeigen'}
          >
            <span className="doc-player-title-row">
              <strong className="doc-player-title">{docTitle(track)}</strong>
              <ChevronUpIcon size={16} className="doc-player-chevron" />
            </span>
            <span className="doc-player-time">
              {player.error ? (
                <span className="doc-player-error">{player.error}</span>
              ) : (
                <>
                  {formatClock(shown)} / {formatClock(duration)}
                </>
              )}
            </span>
          </button>
          <button
            className="doc-player-btn doc-player-close"
            onClick={player.stop}
            aria-label="Wiedergabe beenden"
            title="Wiedergabe beenden"
          >
            <CloseIcon size={18} />
          </button>
        </div>
      </div>
    </>
  );
}
