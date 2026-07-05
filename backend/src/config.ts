import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function bool(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

const isProd = (process.env.NODE_ENV ?? 'development') === 'production';

/**
 * Zentrale Konfiguration. Alle Secrets und Infrastruktur-Pfade kommen aus der
 * Umgebung, damit dasselbe Image lokal und auf dem QNAP (Docker) laufen kann.
 */
export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd,
  port: int('PORT', 4000),

  // Öffentliche Adresse des Frontends (Netlify). Wird für CORS und die in
  // Links eingebetteten Basis-URLs benötigt.
  publicAppUrl: optional('PUBLIC_APP_URL', 'http://localhost:5173').replace(/\/$/, ''),

  // Zusätzlich erlaubte CORS-Origins (kommagetrennt), z. B. die rohe
  // *.netlify.app-Adresse zusätzlich zur eigenen Domain.
  extraCorsOrigins: optional('EXTRA_CORS_ORIGINS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Speicherort. Dieses Verzeichnis liegt auf dem QNAP-Volume, das in den
  // Container gemountet wird (siehe docker-compose.yml). Hier liegen Original-
  // dateien, generierte Varianten, die SQLite-Datenbank und temporäre Uploads.
  dataDir: path.resolve(optional('DATA_DIR', path.join(process.cwd(), 'data'))),

  // Secret zum Signieren der Zugriffs-Token (Space-Sessions + Datei-Token).
  // MUSS in Produktion gesetzt sein.
  jwtSecret: required('JWT_SECRET', isProd ? undefined : 'dev-insecure-jwt-secret-change-me'),

  // Passwort, das zum Erstellen/Verwalten neuer Bereiche nötig ist. So kann
  // nicht jede:r mit Zugriff auf das Frontend beliebig viele Bereiche anlegen.
  adminKey: required('ADMIN_KEY', isProd ? undefined : 'dev-admin-key-change-me'),

  // Wie lange ein Space-Zugang (nach Eingabe des Passworts) gültig bleibt.
  accessTokenTtlDays: int('ACCESS_TOKEN_TTL_DAYS', 60),

  // Upload-Verhalten. Chunk-Grösse für resumable Uploads (Standard 5 MB), damit
  // jede einzelne HTTP-Anfrage klein bleibt (Cloudflare Free limitiert ~100 MB
  // pro Anfrage). Maximale Gesamtgrösse pro Datei (Standard 5 GB für Videos).
  upload: {
    chunkSizeBytes: int('UPLOAD_CHUNK_SIZE_BYTES', 5 * 1024 * 1024),
    maxFileBytes: int('UPLOAD_MAX_FILE_MB', 5120) * 1024 * 1024,
    // Unvollständige Upload-Sessions, die älter als X Stunden sind, werden
    // automatisch aufgeräumt.
    sessionTtlHours: int('UPLOAD_SESSION_TTL_HOURS', 48),
  },

  // Medienverarbeitung (Erzeugen von Varianten / Transcoding). Begrenzt, wie
  // viele Fotos/Videos gleichzeitig verarbeitet werden. sharp und vor allem
  // ffmpeg sind CPU-/RAM-intensiv; ohne Begrenzung kann eine Upload-Spitze
  // (z. B. eine ganze Gruppe lädt gleichzeitig hoch) den Server (QNAP)
  // überlasten und die API träge machen. Uploads laufen davon unabhängig
  // weiter – nur die nachgelagerte Verarbeitung wird in einer Warteschlange
  // gedrosselt.
  processing: {
    concurrency: Math.max(1, int('PROCESS_CONCURRENCY', 2)),
  },

  // Bildvarianten (sharp).
  images: {
    thumbMax: int('IMG_THUMB_MAX', 600),
    previewMax: int('IMG_PREVIEW_MAX', 1800),
    thumbQuality: int('IMG_THUMB_QUALITY', 72),
    previewQuality: int('IMG_PREVIEW_QUALITY', 80),
  },

  // Video-Verarbeitung (ffmpeg). Es werden ein Poster (Standbild) und eine
  // kleinere, gut abspielbare Vorschau (H.264/AAC) erzeugt. Das Original bleibt
  // unangetastet und kann jederzeit heruntergeladen werden.
  video: {
    // Maximale Höhe der Vorschau in Pixeln (Breite proportional).
    previewMaxHeight: int('VIDEO_PREVIEW_MAX_HEIGHT', 720),
    previewCrf: int('VIDEO_PREVIEW_CRF', 26),
    ffmpegPath: optional('FFMPEG_PATH', 'ffmpeg'),
    ffprobePath: optional('FFPROBE_PATH', 'ffprobe'),
    // Falls ffmpeg fehlt, läuft die App weiter (nur ohne Video-Vorschau/Poster).
    enabled: bool('VIDEO_PROCESSING', true),
  },

  // Cookie-Einstellungen (für den Space-Access-Token, optional auch als Cookie).
  cookie: {
    secure: bool('COOKIE_SECURE', isProd),
    sameSite: optional('COOKIE_SAMESITE', isProd ? 'none' : 'lax') as 'none' | 'lax' | 'strict',
    domain: optional('COOKIE_DOMAIN') || undefined,
  },
};

export type AppConfig = typeof config;

export const paths = {
  db: () => path.join(config.dataDir, 'share.db'),
  storage: () => path.join(config.dataDir, 'storage'),
  originals: () => path.join(config.dataDir, 'storage', 'originals'),
  thumbs: () => path.join(config.dataDir, 'storage', 'thumbs'),
  previews: () => path.join(config.dataDir, 'storage', 'previews'),
  posters: () => path.join(config.dataDir, 'storage', 'posters'),
  videoPreviews: () => path.join(config.dataDir, 'storage', 'video-previews'),
  tmpUploads: () => path.join(config.dataDir, 'storage', 'tmp', 'uploads'),
};
