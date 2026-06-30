import { customAlphabet } from 'nanoid';

// URL-sichere, gut lesbare IDs (ohne mehrdeutige Zeichen).
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const idGen = customAlphabet(ALPHABET, 16);
const slugGen = customAlphabet(ALPHABET, 8);

export function newId(): string {
  return idGen();
}

/** Kurzer, im Link verwendeter Slug für einen Bereich, z. B. "k3p9x2qa". */
export function newSlug(): string {
  return slugGen();
}

/** Wandelt einen Namen in einen lesbaren Slug-Anteil um (nur für Anzeige/Hint). */
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
