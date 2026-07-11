import { ApiError } from '../middleware/errors';

/** Kürzt/normalisiert einen String und wirft bei leer/zu lang. */
export function requireString(
  value: unknown,
  field: string,
  opts: { max?: number; min?: number } = {},
): string {
  const s = String(value ?? '').trim();
  const min = opts.min ?? 1;
  if (s.length < min) throw new ApiError(400, `${field} darf nicht leer sein.`);
  if (opts.max && s.length > opts.max) throw new ApiError(400, `${field} ist zu lang.`);
  return s;
}

/** Optionaler String (leer → null). */
export function optionalString(value: unknown, max = 2000): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

/**
 * Prüft einen Geldbetrag in Rappen/Cents: muss eine positive Ganzzahl sein.
 * Es findet KEINE Fliesskomma-Rechnung statt – der Client übermittelt bereits
 * ganzzahlige Rappen.
 */
export function requireAmountCents(value: unknown, field = 'Betrag'): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n)) throw new ApiError(400, `${field} muss eine ganze Zahl (Rappen) sein.`);
  if (n <= 0) throw new ApiError(400, `${field} muss grösser als null sein.`);
  if (n > 1_000_000_000_00) throw new ApiError(400, `${field} ist unrealistisch hoch.`);
  return n;
}

const CURRENCIES = new Set(['CHF', 'EUR', 'USD', 'GBP']);

export function normalizeCurrency(value: unknown, fallback = 'CHF'): string {
  const s = String(value ?? '')
    .trim()
    .toUpperCase();
  if (!s) return fallback;
  if (!CURRENCIES.has(s)) throw new ApiError(400, 'Nicht unterstützte Währung.');
  return s;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validiert ein lokales Datum im Format YYYY-MM-DD. */
export function requireLocalDate(value: unknown, field = 'Datum'): string {
  const s = String(value ?? '').trim();
  if (!DATE_RE.test(s)) throw new ApiError(400, `${field} muss im Format YYYY-MM-DD vorliegen.`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, `${field} ist ungültig.`);
  return s;
}

export function optionalLocalDate(value: unknown, field = 'Datum'): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireLocalDate(value, field);
}

/** Validiert einen ISO-Zeitstempel und gibt ihn normalisiert zurück. */
export function requireIsoTimestamp(value: unknown, field = 'Zeitpunkt'): string {
  const s = String(value ?? '').trim();
  const d = new Date(s);
  if (!s || Number.isNaN(d.getTime())) {
    throw new ApiError(400, `${field} ist kein gültiger Zeitstempel.`);
  }
  return d.toISOString();
}

export function optionalIsoTimestamp(value: unknown, field = 'Zeitpunkt'): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireIsoTimestamp(value, field);
}

export function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}
