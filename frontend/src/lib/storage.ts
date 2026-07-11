// Kleine, typsichere Helfer rund um localStorage. Speichert pro Bereich den
// Access-Token, den zuletzt verwendeten Uploader-Namen sowie Hinweise auf
// unterbrochene Uploads (damit der Nutzer sie nach einem Browser-Neustart
// fortsetzen kann, indem er die gleichen Dateien erneut auswählt).

const TOKEN_PREFIX = 'share.token.'; // + slug
const NAME_KEY = 'share.uploaderName';
const ADMIN_KEY = 'share.adminKey';
const PENDING_PREFIX = 'share.pending.'; // + spaceId
const VISITED_KEY = 'share.visitedSpaces';
const PARTICIPANT_PREFIX = 'share.participant.'; // + slug

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

export const nameStore = {
  get: () => safeGet(NAME_KEY) ?? '',
  set: (name: string) => safeSet(NAME_KEY, name),
};

export const adminKeyStore = {
  get: () => safeGet(ADMIN_KEY) ?? '',
  set: (key: string) => safeSet(ADMIN_KEY, key),
  clear: () => safeRemove(ADMIN_KEY),
};

// Gewählte Teilnehmer-Identität pro Bereich (für die Modulaktionen). Nur lokal
// im Browser – bewusstes Vertrauensmodell für Familie & Freunde.
export const participantStore = {
  get: (slug: string) => safeGet(PARTICIPANT_PREFIX + slug),
  set: (slug: string, id: string) => safeSet(PARTICIPANT_PREFIX + slug, id),
  clear: (slug: string) => safeRemove(PARTICIPANT_PREFIX + slug),
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
