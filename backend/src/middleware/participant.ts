import { NextFunction, Request, Response } from 'express';
import { findParticipant } from '../lib/participants';
import { ApiError } from './errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Teilnehmer-ID aus dem Header X-Participant-Id, sofern gültig für req.spaceId. */
      participantId?: string;
    }
  }
}

function participantIdOf(req: Request): string | null {
  const header = req.headers['x-participant-id'];
  const raw = Array.isArray(header) ? header[0] : header;
  const value = String(raw ?? '').trim();
  return value || null;
}

/**
 * Liest die Teilnehmer-ID aus dem Header und prüft, dass sie zum aktuellen
 * Bereich gehört. Setzt req.participantId (oder lässt es undefined). Wirft nur,
 * wenn eine übermittelte ID NICHT zum Bereich gehört (Schutz gegen fremde IDs).
 *
 * Bewusstes Vertrauensmodell für Familie & Freunde – dies ist KEINE sichere
 * Benutzer-Authentifizierung.
 */
export function resolveParticipant(req: Request, _res: Response, next: NextFunction) {
  const id = participantIdOf(req);
  if (!id) {
    req.participantId = undefined;
    return next();
  }
  if (!req.spaceId) throw new ApiError(401, 'Kein Zugriff – bitte Bereich öffnen.');
  const found = findParticipant(id, req.spaceId);
  if (!found) throw new ApiError(403, 'Unbekannter Teilnehmer für diesen Bereich.');
  req.participantId = found.id;
  next();
}

/** Wie resolveParticipant, verlangt aber zwingend eine gültige Teilnehmer-ID. */
export function requireParticipant(req: Request, res: Response, next: NextFunction) {
  resolveParticipant(req, res, () => {
    if (!req.participantId) {
      throw new ApiError(400, 'Bitte zuerst auswählen, wer du bist.');
    }
    next();
  });
}
