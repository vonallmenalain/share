import { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { getDb } from '../db';
import { ApiError } from './errors';
import { adminLimiter } from './rateLimit';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Wurde ein gültiger Admin-Schlüssel (X-Admin-Key) mitgeschickt? */
      isAdmin?: boolean;
    }
  }
}

/** Meldung, wenn jemand ohne Admin-Schlüssel in einem gesperrten Bereich etwas ändern will. */
export const LOCKED_MESSAGE =
  'Dieser Bereich ist nur zum Ansehen freigegeben – hochladen oder ändern kann hier nur der Administrator.';

function adminKeyOf(req: Request): string | null {
  const raw = req.headers['x-admin-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value ? value : null;
}

/**
 * Erkennt Administrator:innen an einem mitgeschickten Admin-Schlüssel
 * (Header `X-Admin-Key`) und setzt `req.isAdmin`. Ohne Header passiert nichts
 * weiter – normale Anfragen bleiben unverändert. Wird ein Schlüssel
 * mitgeschickt, läuft die Anfrage durch denselben Rate-Limiter wie die
 * Admin-Endpunkte, und ein falscher Schlüssel wird mit 401 abgelehnt. So lässt
 * sich der Schlüssel auch über diese Endpunkte nicht durchprobieren.
 */
export function detectAdmin(req: Request, res: Response, next: NextFunction) {
  req.isAdmin = false;
  const key = adminKeyOf(req);
  if (!key) return next();
  void adminLimiter(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (key !== config.adminKey) return next(new ApiError(401, 'Falscher Admin-Schlüssel.'));
    req.isAdmin = true;
    next();
  });
}

/** Ist im Bereich die Upload-Sperre („reiner Ansichtslink") aktiv? */
export function isUploadsLocked(spaceId: string): boolean {
  const row = getDb().prepare('SELECT uploads_locked FROM spaces WHERE id = ?').get(spaceId) as
    | { uploads_locked: number }
    | undefined;
  return row?.uploads_locked === 1;
}

/**
 * Verlangt, dass der aktuelle Bereich Änderungen an Dateien (Galerie und
 * Dokumente) erlaubt: Ohne Upload-Sperre darf das jede Person mit dem Link
 * (wie bisher), mit Sperre nur der Administrator. Muss nach requireSpace und
 * detectAdmin laufen.
 */
export function requireManage(req: Request, _res: Response, next: NextFunction) {
  if (!req.spaceId) throw new ApiError(401, 'Kein Zugriff – bitte Bereich öffnen.');
  if (!req.isAdmin && isUploadsLocked(req.spaceId)) throw new ApiError(403, LOCKED_MESSAGE);
  next();
}

/** Admin erkennen und Änderungsrecht prüfen – für Routen, die Dateien verändern. */
export const manageGuard = [detectAdmin, requireManage];
