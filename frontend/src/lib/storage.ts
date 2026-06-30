// Kleine, typsichere Helfer rund um localStorage. Speichert pro Bereich den
// Access-Token, den zuletzt verwendeten Uploader-Namen sowie Hinweise auf
// unterbrochene Uploads (damit der Nutzer sie nach einem Browser-Neustart
// fortsetzen kann, indem er die gleichen Dateien erneut auswählt).

const TOKEN_PREFIX = 'share.token.'; // + slug
const NAME_KEY = 'share.uploaderName';
const ADMIN_KEY = 'share.adminKey';
const PENDING_PREFIX = 'share.pending.'; // + spaceId

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
