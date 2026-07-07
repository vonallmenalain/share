import type { Request } from 'express';
import { getDb } from '../db';
import { newId } from './ids';

/**
 * Zugriffsprotokoll – bewusst OHNE externe Datenbank. Jeder Zugriff auf einen
 * Bereich wird in der bestehenden lokalen SQLite-Datei (share.db) festgehalten.
 * Diese Daten sind ausschliesslich über die Admin-Endpunkte abrufbar; normale
 * Nutzer:innen (die Fotos ansehen/hochladen) sehen davon nichts.
 *
 * Standort: Der „genaue Standort" kann ohne kostenpflichtigen Dienst nicht aus
 * der IP allein bestimmt werden. Läuft die App hinter einem Cloudflare-Tunnel
 * (so wie in dieser Anleitung beschrieben), liefert Cloudflare die Geodaten
 * gratis als HTTP-Header mit – dazu in Cloudflare die Managed Transform
 * „Add visitor location headers" aktivieren. Fehlen diese Header, wird nur die
 * IP (und, falls vorhanden, das Land aus `cf-ipcountry`) gespeichert.
 */

/** Erstes nicht-leeres Header-Feld aus einer Liste möglicher Namen. */
function header(req: Request, ...names: string[]): string | null {
  for (const name of names) {
    const raw = req.headers[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** Ermittelt die echte Client-IP (Cloudflare bzw. X-Forwarded-For / req.ip). */
function clientIp(req: Request): string | null {
  const cf = header(req, 'cf-connecting-ip');
  if (cf) return cf;
  const fwd = header(req, 'x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() || null;
  return req.ip ?? null;
}

/** Kürzt sehr lange Werte, damit die Datenbank nicht mit Müll geflutet wird. */
function clip(value: string | null, max = 512): string | null {
  if (value == null) return null;
  return value.length > max ? value.slice(0, max) : value;
}

export interface ClientContext {
  ip: string | null;
  userAgent: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  postal: string | null;
  latitude: string | null;
  longitude: string | null;
  timezone: string | null;
}

/** Liest IP, Gerät und (soweit vorhanden) Standort aus der Anfrage. */
export function readClientContext(req: Request): ClientContext {
  return {
    ip: clip(clientIp(req), 64),
    userAgent: clip(header(req, 'user-agent'), 512),
    country: clip(header(req, 'cf-ipcountry'), 8),
    region: clip(header(req, 'cf-region', 'cf-ipregion', 'cf-region-code', 'cf-ipregioncode'), 96),
    city: clip(header(req, 'cf-ipcity'), 96),
    postal: clip(header(req, 'cf-postal-code', 'cf-ippostalcode'), 32),
    latitude: clip(header(req, 'cf-iplatitude'), 32),
    longitude: clip(header(req, 'cf-iplongitude'), 32),
    timezone: clip(header(req, 'cf-timezone', 'cf-iptimezone'), 96),
  };
}

/**
 * Protokolliert einen Zugriff auf einen Bereich. Fehler beim Schreiben werden
 * bewusst nur geloggt und nicht weitergeworfen – ein fehlgeschlagenes
 * Protokoll darf den eigentlichen Zugriff niemals verhindern.
 */
export function logAccess(
  req: Request,
  spaceId: string,
  kind: 'enter' | 'open',
  visitor?: string | null,
): void {
  try {
    const ctx = readClientContext(req);
    getDb()
      .prepare(
        `INSERT INTO access_logs
           (id, space_id, at, kind, visitor, ip, user_agent,
            country, region, city, postal, latitude, longitude, timezone)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId(),
        spaceId,
        new Date().toISOString(),
        kind,
        clip((visitor ?? '').trim() || null, 96),
        ctx.ip,
        ctx.userAgent,
        ctx.country,
        ctx.region,
        ctx.city,
        ctx.postal,
        ctx.latitude,
        ctx.longitude,
        ctx.timezone,
      );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[access-log] failed', err);
  }
}
