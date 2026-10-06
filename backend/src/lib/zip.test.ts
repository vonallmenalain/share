import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipEntryName, zipFileName } from './zip';

test('zip: Dateiname aus dem Namen des Bereichs', () => {
  assert.equal(zipFileName('Lieder DKA 2026', 'dokumente'), 'Lieder DKA 2026.zip');
  assert.equal(zipFileName('Ferien: Tessin/Süd', 'medien'), 'Ferien Tessin Süd.zip');
  assert.equal(zipFileName('  a\n\tb  ', 'x'), 'a b.zip');
  assert.equal(zipFileName('???', 'dokumente'), 'dokumente.zip');
  assert.equal(zipFileName(undefined, 'medien'), 'medien.zip');
  assert.equal(zipFileName('x'.repeat(150), 'y'), `${'x'.repeat(100)}.zip`);
});

test('zip: doppelte Namen im ZIP werden eindeutig', () => {
  const used = new Set<string>();
  const a = { id: 'aaaaaa111111', original_filename: '01 Ave Maria.pdf', ext: 'pdf' };
  const b = { id: 'bbbbbb222222', original_filename: '01 Ave Maria.pdf', ext: 'pdf' };
  const c = { id: 'cccccc333333', original_filename: '../geheim/Lied.mp3', ext: 'mp3' };
  const d = { id: 'dddddd444444', original_filename: '', ext: 'pdf' };
  assert.equal(zipEntryName(a, used), '01 Ave Maria.pdf');
  assert.equal(zipEntryName(b, used), '01 Ave Maria-bbbbbb.pdf');
  assert.equal(zipEntryName(c, used), 'Lied.mp3');
  assert.equal(zipEntryName(d, used), 'dddddd444444.pdf');
});
