import { ModuleKey } from '../api/client';

/**
 * Besteht ein Bereich nur aus dem Dokumente-Modul? Dann gibt es dafür den
 * schlanken Ansichtslink `/d/<slug>`: ohne Navigation, ohne Profil-Menü – und
 * mit einer neutralen Link-Vorschau (z. B. in WhatsApp) statt der Foto-Vorschau.
 */
export function isDocumentsOnly(modules: ModuleKey[] | undefined | null): boolean {
  return !!modules && modules.length === 1 && modules[0] === 'documents';
}

/** Pfad, unter dem ein Bereich geöffnet bzw. geteilt wird. */
export function spacePath(slug: string, modules: ModuleKey[] | undefined | null): string {
  return isDocumentsOnly(modules) ? `/d/${slug}` : `/s/${slug}`;
}

/** Vollständige URL zum Teilen (inkl. Domain). */
export function spaceShareUrl(slug: string, modules: ModuleKey[] | undefined | null): string {
  return `${window.location.origin}${spacePath(slug, modules)}`;
}

/** Teilt einen Link über das Teilen-Menü des Geräts, sonst Zwischenablage. */
export async function shareLink(
  url: string,
  title: string,
): Promise<'shared' | 'copied' | 'cancelled' | 'manual'> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    window.prompt('Link zum Teilen:', url);
    return 'manual';
  }
}
