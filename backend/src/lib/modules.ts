import type Database from 'better-sqlite3';
import { getDb, ModuleKey, SpaceModuleRow } from '../db';

export const MODULE_KEYS: ModuleKey[] = ['photos', 'finance', 'shopping', 'notes', 'calendar'];

/**
 * Immer aktivierte Module, die nicht deaktiviert werden dürfen. Fotos &
 * Videos (Galerie) sind seit Einführung der Modulauswahl beim Anlegen
 * optional – ein Bereich kann z. B. auch nur aus dem Finanzmodul bestehen.
 */
export const ALWAYS_ON: ModuleKey[] = [];

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === 'string' && (MODULE_KEYS as string[]).includes(value);
}

/**
 * Liefert die aktivierten Modul-Schlüssel eines Bereichs. Fotos & Videos
 * (Galerie) ist wie jedes andere Modul optional; nur wenn für einen Bereich
 * noch gar kein Eintrag existiert (Bereiche von vor der Modul-Einführung),
 * bleibt die Galerie aus Kompatibilitätsgründen aktiv.
 */
export function getEnabledModules(spaceId: string, db: Database.Database = getDb()): ModuleKey[] {
  const rows = db
    .prepare('SELECT module_key, enabled FROM space_modules WHERE space_id = ?')
    .all(spaceId) as Pick<SpaceModuleRow, 'module_key' | 'enabled'>[];
  const rowKeys = new Set(rows.map((r) => r.module_key));
  const enabled = new Set<ModuleKey>();
  for (const r of rows) if (r.enabled) enabled.add(r.module_key);
  if (!rowKeys.has('photos')) enabled.add('photos');
  // In stabiler Reihenfolge zurückgeben.
  return MODULE_KEYS.filter((k) => enabled.has(k));
}

export function isModuleEnabled(
  spaceId: string,
  moduleKey: ModuleKey,
  db: Database.Database = getDb(),
): boolean {
  const row = db
    .prepare('SELECT enabled FROM space_modules WHERE space_id = ? AND module_key = ?')
    .get(spaceId, moduleKey) as { enabled: number } | undefined;
  if (!row) return moduleKey === 'photos';
  return !!row.enabled;
}

/**
 * Setzt die aktivierten Module eines Bereichs. Bereits deaktivierte Module
 * werden nur ausgeblendet – vorhandene Daten bleiben erhalten. Muss
 * innerhalb einer bestehenden Transaktion aufgerufen werden können; die
 * Aufrufer sorgen dafür.
 */
export function setEnabledModules(
  spaceId: string,
  keys: ModuleKey[],
  db: Database.Database = getDb(),
): void {
  const now = new Date().toISOString();
  const desired = new Set<ModuleKey>(keys.filter(isModuleKey));
  for (const k of ALWAYS_ON) desired.add(k);

  const upsert = db.prepare(
    `INSERT INTO space_modules (space_id, module_key, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(space_id, module_key)
       DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
  );
  for (const key of MODULE_KEYS) {
    const enabled = desired.has(key) ? 1 : 0;
    upsert.run(spaceId, key, enabled, now, now);
  }
}
