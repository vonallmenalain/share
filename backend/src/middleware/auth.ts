import { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { verifyAccessToken } from '../lib/auth';
import { ApiError } from './errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      spaceId?: string;
    }
  }
}

/** Liest den Access-Token aus Header (Bearer) oder Query (`token`) / Cookie. */
function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim();
  const q = req.query.token;
  if (typeof q === 'string' && q) return q;
  const cookie = (req as { cookies?: Record<string, string> }).cookies?.access_token;
  if (cookie) return cookie;
  return null;
}

/** Verlangt einen gültigen Space-Access-Token und setzt req.spaceId. */
export function requireSpace(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) throw new ApiError(401, 'Kein Zugriff – bitte Bereich öffnen.');
  const payload = verifyAccessToken(token);
  if (!payload) throw new ApiError(401, 'Zugriff abgelaufen – bitte Bereich erneut öffnen.');
  req.spaceId = payload.sid;
  next();
}

/** Verlangt den Admin-Schlüssel (zum Erstellen/Verwalten von Bereichen). */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const key =
    (req.headers['x-admin-key'] as string | undefined) ??
    (typeof req.query.adminKey === 'string' ? req.query.adminKey : undefined);
  if (!key || key !== config.adminKey) {
    throw new ApiError(401, 'Falscher oder fehlender Admin-Schlüssel.');
  }
  next();
}
