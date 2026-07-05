import rateLimit from 'express-rate-limit';

/**
 * Rate-Limiter gegen das Ausprobieren von Passwörtern/Admin-Schlüsseln.
 *
 * `skipSuccessfulRequests: true` sorgt dafür, dass NUR fehlgeschlagene Versuche
 * (falsches Passwort / falscher Schlüssel → 4xx) gezählt werden. Erfolgreiche
 * Anfragen zählen nicht mit – so werden legitime Nutzer:innen (auch viele
 * gleichzeitig hinter derselben IP/NAT, z. B. am selben WLAN) nicht ausgesperrt,
 * während Brute-Force-Versuche schnell gebremst werden.
 *
 * Hinter dem Cloudflare-Tunnel läuft die App mit `trust proxy = 1`, daher wird
 * die echte Client-IP aus `X-Forwarded-For` verwendet.
 */
const common = {
  windowMs: 15 * 60 * 1000, // 15 Minuten
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Zu viele Versuche. Bitte in einigen Minuten erneut versuchen.' },
};

/** Für das Betreten eines Bereichs (Passwortprüfung). */
export const accessLimiter = rateLimit({ ...common, limit: 15 });

/** Für Admin-Endpunkte (Erstellen/Verwalten von Bereichen). */
export const adminLimiter = rateLimit({ ...common, limit: 30 });
