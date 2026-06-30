import jwt from 'jsonwebtoken';
import { config } from '../config';

/**
 * Zugriffs-Token für einen Bereich (Space). Wird ausgestellt, sobald jemand
 * den Bereich betreten darf (Link geöffnet und – falls gesetzt – Passwort
 * korrekt eingegeben). Trägt nur die Space-ID und wird für alle API-Aufrufe
 * sowie zum Ausliefern der Mediendateien verwendet.
 */
export interface AccessTokenPayload {
  sid: string; // space id
}

export function signAccessToken(spaceId: string): string {
  return jwt.sign({ sid: spaceId }, config.jwtSecret, {
    expiresIn: `${config.accessTokenTtlDays}d`,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AccessTokenPayload;
    if (!decoded || typeof decoded.sid !== 'string') return null;
    return decoded;
  } catch {
    return null;
  }
}
