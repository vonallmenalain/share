// Kleine, typsichere Helfer rund um localStorage. Speichert pro Bereich den
// Access-Token, den zuletzt verwendeten Uploader-Namen sowie Hinweise auf
// unterbrochene Uploads (damit der Nutzer sie nach einem Browser-Neustart
// fortsetzen kann, indem er die gleichen Dateien erneut auswählt).

const TOKEN_PREFIX = 'share.token.'; // + slug
const NAME_KEY = 'share.uploaderName'; // veraltet, siehe identityStore (Migration)
const IDENTITY_KEY = 'share.identity';
const ADMIN_KEY = 'share.adminKey';
const PENDING_PREFIX = 'share.pending.'; // + spaceId
const VISITED_KEY = 'share.visitedSpaces';
const PARTICIPANT_PREFIX = 'share.participant.'; // + slug
const CALENDAR_VIEW_KEY = 'share.calendarView';
const SHOPPING_SORT_PREFIX = 'share.shoppingSort.'; // + slug

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota / privacy mode */
  }
}
function safeRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const tokenStore = {
  get: (slug: string) => safeGet(TOKEN_PREFIX + slug),
  set: (slug: string, token: string) => safeSet(TOKEN_PREFIX + slug, token),
  clear: (slug: string) => safeRemove(TOKEN_PREFIX + slug),
};

/**
 * Die geräteweite Identität („wer bin ich") – Name und optionaler Schutz-Code
 * (PIN). Wird EINMAL gespeichert und automatisch für JEDEN Bereich verwendet,
 * ohne dass beim Wechsel zwischen Bereichen erneut nachgefragt wird (siehe
 * useParticipants). Bewusst kein echtes Login – nur ein einfacher, lokal
 * gespeicherter Hinweis, wer gerade unterwegs ist.
 */
export interface StoredIdentity {
  name: string;
  pin: string | null;
}

export const identityStore = {
  get(): StoredIdentity | null {
    const raw = safeGet(IDENTITY_KEY);
    if (raw) {
      try {
        const v = JSON.parse(raw) as Partial<StoredIdentity>;
        if (v && typeof v.name === 'string' && v.name.trim()) {
          return { name: v.name, pin: typeof v.pin === 'string' && v.pin ? v.pin : null };
        }
      } catch {
        /* fällt auf die Migration unten zurück */
      }
    }
    // Migration von der früheren, reinen Namensspeicherung (ohne Code).
    const legacyName = safeGet(NAME_KEY);
    if (legacyName && legacyName.trim()) {
      const migrated: StoredIdentity = { name: legacyName.trim(), pin: null };
      safeSet(IDENTITY_KEY, JSON.stringify(migrated));
      return migrated;
    }
    return null;
  },
  set(name: string, pin: string | null) {
    safeSet(IDENTITY_KEY, JSON.stringify({ name, pin } satisfies StoredIdentity));
  },
  /** Setzt nur den Namen, behält einen vorhandenen Code unverändert. */
  setName(name: string) {
    const cur = identityStore.get();
    identityStore.set(name, cur?.pin ?? null);
  },
  /** Setzt/entfernt nur den Code, behält den Namen unverändert. */
  setPin(pin: string | null) {
    const cur = identityStore.get();
    if (!cur) return;
    identityStore.set(cur.name, pin);
  },
  clear() {
    safeRemove(IDENTITY_KEY);
  },
};

/** @deprecated Zeigt weiterhin auf die geräteweite Identität (siehe identityStore). */
export const nameStore = {
  get: () => identityStore.get()?.name ?? '',
  set: (name: string) => identityStore.setName(name),
};

export const adminKeyStore = {
  get: () => safeGet(ADMIN_KEY) ?? '',
  set: (key: string) => safeSet(ADMIN_KEY, key),
  clear: () => safeRemove(ADMIN_KEY),
};

// Aufgelöste Teilnehmer-Identität pro Bereich – dient nur als schneller
// Cache, damit ein einmal aufgelöster Bereich beim nächsten Besuch nicht neu
// aufgelöst werden muss. Die eigentliche Identität (Name + Code) ist
// geräteweit in identityStore gespeichert.
export const participantStore = {
  get: (slug: string) => safeGet(PARTICIPANT_PREFIX + slug),
  set: (slug: string, id: string) => safeSet(PARTICIPANT_PREFIX + slug, id),
  /** Entfernt die Auswahl NUR für diesen einen Bereich – andere Bereiche
   * behalten ihre eigene, unabhängig gespeicherte Auswahl (siehe
   * useParticipants: switchIdentity betrifft bewusst nur den aktuellen
   * Bereich, damit gewählte Identitäten nicht bereichsübergreifend
   * verloren gehen oder sich vermischen). */
  clear: (slug: string) => safeRemove(PARTICIPANT_PREFIX + slug),
};

// Zuletzt gewählte Kalenderansicht (Tag/Woche/Monat) – geräteweit, damit die
// Wahl beim nächsten Besuch erhalten bleibt. Standard ist die Wochenansicht.
export type CalendarViewMode = 'day' | 'week' | 'month';

export const calendarViewStore = {
  get(): CalendarViewMode {
    const v = safeGet(CALENDAR_VIEW_KEY);
    return v === 'day' || v === 'week' || v === 'month' ? v : 'week';
  },
  set(mode: CalendarViewMode) {
    safeSet(CALENDAR_VIEW_KEY, mode);
  },
};

// Sortiermodus der Einkaufsliste (Standard = zuletzt Hinzugefügte/Abgehakte
// oben, Manuell = per Ziehen selbst festgelegte Reihenfolge). Pro Bereich.
export type ShoppingSortMode = 'recent' | 'manual';

export const shoppingSortStore = {
  get(slug: string): ShoppingSortMode {
    return safeGet(SHOPPING_SORT_PREFIX + slug) === 'manual' ? 'manual' : 'recent';
  },
  set(slug: string, mode: ShoppingSortMode) {
    safeSet(SHOPPING_SORT_PREFIX + slug, mode);
  },
};

export interface PendingUpload {
  fingerprint: string; // filename|size|lastModified
  uploadId: string;
  filename: string;
  size: number;
  totalChunks: number;
  updatedAt: number;
}

export const pendingStore = {
  all(spaceId: string): PendingUpload[] {
    const raw = safeGet(PENDING_PREFIX + spaceId);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as PendingUpload[];
    } catch {
      return [];
    }
  },
  upsert(spaceId: string, entry: PendingUpload) {
    const list = pendingStore.all(spaceId).filter((p) => p.fingerprint !== entry.fingerprint);
    list.push(entry);
    safeSet(PENDING_PREFIX + spaceId, JSON.stringify(list));
  },
  remove(spaceId: string, fingerprint: string) {
    const list = pendingStore.all(spaceId).filter((p) => p.fingerprint !== fingerprint);
    if (list.length) safeSet(PENDING_PREFIX + spaceId, JSON.stringify(list));
    else safeRemove(PENDING_PREFIX + spaceId);
  },
};

export function fingerprintOf(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

// Bereiche, die diese:r Nutzer:in per Link geöffnet hat. Dient dem Wechsel
// zwischen mehreren Bereichen über das Profil-Menü oben rechts. Es werden
// bewusst NUR Bereiche gespeichert, deren Link jemand tatsächlich angeklickt
// (also geöffnet) hat – niemals alle vorhandenen Bereiche.
export interface VisitedSpace {
  slug: string;
  name: string;
  /** Zeitpunkt des letzten Besuchs (ms seit Epoch) – für die Sortierung. */
  visitedAt: number;
}

const VISITED_LIMIT = 30;

export const visitedSpacesStore = {
  all(): VisitedSpace[] {
    const raw = safeGet(VISITED_KEY);
    if (!raw) return [];
    try {
      const list = JSON.parse(raw) as VisitedSpace[];
      if (!Array.isArray(list)) return [];
      return list
        .filter((s): s is VisitedSpace => !!s && typeof s.slug === 'string' && s.slug.length > 0)
        .sort((a, b) => (b.visitedAt ?? 0) - (a.visitedAt ?? 0));
    } catch {
      return [];
    }
  },
  /** Merkt sich einen besuchten Bereich (oder aktualisiert Name/Zeitpunkt). */
  record(slug: string, name: string) {
    if (!slug) return;
    const list = visitedSpacesStore.all().filter((s) => s.slug !== slug);
    list.unshift({ slug, name: name || slug, visitedAt: Date.now() });
    safeSet(VISITED_KEY, JSON.stringify(list.slice(0, VISITED_LIMIT)));
  },
  remove(slug: string) {
    const list = visitedSpacesStore.all().filter((s) => s.slug !== slug);
    if (list.length) safeSet(VISITED_KEY, JSON.stringify(list));
    else safeRemove(VISITED_KEY);
  },
};
