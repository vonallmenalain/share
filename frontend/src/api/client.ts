export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000').replace(
  /\/$/,
  '',
);

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Space-Access-Token (Bearer). */
  token?: string;
  /** Admin-Schlüssel (X-Admin-Key). */
  adminKey?: string;
  /** Anzeigename der aktuellen Person (X-Uploader-Name) – z. B. für Löschrechte. */
  uploaderName?: string;
  /** Stabile Teilnehmer-ID für Modulaktionen (X-Participant-Id). */
  participantId?: string;
  signal?: AbortSignal;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.adminKey) headers['X-Admin-Key'] = opts.adminKey;
  if (opts.uploaderName) headers['X-Uploader-Name'] = encodeURIComponent(opts.uploaderName);
  if (opts.participantId) headers['X-Participant-Id'] = opts.participantId;

  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers,
    signal: opts.signal,
  };
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }

  const res = await fetch(`${API_BASE}${path}`, init);
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => ({})) : await res.text();

  if (!res.ok) {
    const message =
      (isJson && (data as { error?: string }).error) || 'Es ist ein Fehler aufgetreten.';
    throw new ApiError(res.status, message);
  }
  return data as T;
}

/** Baut eine absolute Datei-URL mit Access-Token im Query. */
export function fileUrl(path: string, token: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${API_BASE}${path}${sep}token=${encodeURIComponent(token)}`;
}

/**
 * Lädt ein angepasstes Vorschaubild (bereits zugeschnitten/rotiert) als rohe
 * Bild-Bytes hoch und gibt das aktualisierte Item zurück.
 */
export async function uploadThumb(
  itemId: string,
  blob: Blob,
  opts: { token: string; uploaderName?: string },
): Promise<Item> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.token}`,
    'Content-Type': blob.type || 'image/jpeg',
  };
  if (opts.uploaderName) headers['X-Uploader-Name'] = encodeURIComponent(opts.uploaderName);
  const res = await fetch(`${API_BASE}/api/items/${itemId}/thumb`, {
    method: 'POST',
    headers,
    body: blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string }).error || 'Upload fehlgeschlagen.');
  }
  return (data as { item: Item }).item;
}

// ---- Typen -----------------------------------------------------------------

export type ModuleKey = 'photos' | 'finance' | 'shopping' | 'notes' | 'calendar';

export interface Space {
  id: string;
  slug: string;
  name: string;
  hasPassword: boolean;
  createdAt: string;
  /** Aktivierte Module dieses Bereichs (photos ist immer dabei). */
  modules: ModuleKey[];
  /** Abrechnungswährung, falls das Finanzmodul aktiv ist. */
  financeCurrency?: string | null;
  itemCount?: number;
  deletedCount?: number;
  accessCount?: number;
  lastAccessAt?: string | null;
}

/** Einzelner protokollierter Zugriff (nur für den Admin sichtbar). */
export interface AccessLog {
  id: string;
  at: string;
  kind: 'enter' | 'open';
  visitor: string | null;
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

export interface AccessLogsResponse {
  total: number;
  uniqueIps: number;
  uniqueVisitors: number;
  returned: number;
  logs: AccessLog[];
}

export type ItemState = 'active' | 'deleted';

export interface Item {
  id: string;
  kind: 'photo' | 'video';
  status: 'processing' | 'ready' | 'failed';
  state: ItemState;
  stateBy: string | null;
  stateAt: string | null;
  uploaderName: string;
  filename: string;
  ext: string;
  mime: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  sizeBytes: number;
  takenAt: string | null;
  position: number;
  favorite: boolean;
  /** Zähler zum Cache-Busting, wenn das Vorschaubild angepasst wurde. */
  thumbVersion: number;
  /** Masse des (ggf. angepassten) Thumbnails – bestimmen das Kachel-Seitenverhältnis. */
  thumbW: number | null;
  thumbH: number | null;
  scope?: 'gallery' | 'note';
  noteId?: string | null;
  createdAt: string;
  hasPreview: boolean;
  hasPoster: boolean;
}

// ---- Teilnehmer ------------------------------------------------------------

export interface Participant {
  id: string;
  name: string;
  color: string | null;
  archived: boolean;
  /** Ob diese Identität mit einem Code (PIN) geschützt ist. */
  hasPin: boolean;
  createdAt: string;
}

// ---- Finanzen --------------------------------------------------------------

export type SplitMode = 'equal' | 'manual';
export type ExpenseStatus = 'open' | 'settled';

export interface ExpenseSplit {
  participantId: string;
  shareCents: number;
}

export interface Expense {
  id: string;
  title: string;
  amountCents: number;
  currency: string;
  paidByParticipantId: string;
  expenseDate: string;
  notes: string | null;
  splitMode: SplitMode;
  status: ExpenseStatus;
  createdByParticipantId: string | null;
  createdAt: string;
  updatedAt: string;
  splits: ExpenseSplit[];
}

export interface Balance {
  participantId: string;
  balanceCents: number;
}

export interface Transfer {
  fromParticipantId: string;
  toParticipantId: string;
  amountCents: number;
}

export interface FinanceSummary {
  currency: string;
  participants: Participant[];
  openExpenseCount: number;
  totalOpenCents: number;
  totalAllTimeCents: number;
  balances: Balance[];
  transfers: Transfer[];
}

export interface SettlementTransfer {
  id: string;
  fromParticipantId: string;
  toParticipantId: string;
  amountCents: number;
  paidAt: string | null;
}

export interface Settlement {
  id: string;
  currency: string;
  createdByParticipantId: string | null;
  createdAt: string;
  reopenedAt: string | null;
  expenseIds: string[];
  transfers: SettlementTransfer[];
}

export interface SettlementPreview {
  currency: string;
  balances: Balance[];
  transfers: Transfer[];
  expenseCount: number;
  totalCents: number;
}

// ---- Einkaufsliste ---------------------------------------------------------

export interface ShoppingItem {
  id: string;
  text: string;
  quantity: string | null;
  checked: boolean;
  checkedByParticipantId: string | null;
  checkedAt: string | null;
  position: number;
  createdByParticipantId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---- Notizen ---------------------------------------------------------------

export type NoteType = 'text' | 'checklist';

export interface NoteChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  position: number;
}

export interface Note {
  id: string;
  title: string;
  noteType: NoteType;
  body: string | null;
  pinned: boolean;
  createdByParticipantId: string | null;
  createdAt: string;
  updatedAt: string;
  checklistCount: number;
  checklistCheckedCount: number;
  attachmentCount: number;
  attachments: Item[];
  checklist?: NoteChecklistItem[];
}

// ---- Kalender --------------------------------------------------------------

export interface CalendarEvent {
  id: string;
  title: string;
  startAt: string | null;
  endAt: string | null;
  allDay: boolean;
  allDayDate: string | null;
  location: string | null;
  description: string | null;
  createdByParticipantId: string | null;
  createdAt: string;
  updatedAt: string;
}
