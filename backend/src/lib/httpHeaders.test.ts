import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentDisposition } from './httpHeaders';

test('contentDisposition: reiner ASCII-Name bleibt lesbar', () => {
  assert.equal(
    contentDisposition('attachment', 'Noten.pdf'),
    `attachment; filename="Noten.pdf"; filename*=UTF-8''Noten.pdf`,
  );
});

test('contentDisposition: Sonderzeichen ergeben einen gültigen Header-Wert', () => {
  const value = contentDisposition('inline', 'Ave Maria – Schubert ♪.mp3');
  // Node lehnt Header-Werte mit Zeichen ausserhalb von Latin-1 ab.
  assert.doesNotMatch(value, /[^\t\x20-\x7e]/);
  assert.match(value, /^inline; filename="Ave Maria _ Schubert _\.mp3"; /);
  assert.match(value, /filename\*=UTF-8''Ave%20Maria%20%E2%80%93%20Schubert%20%E2%99%AA\.mp3$/);
});

test('contentDisposition: Anführungszeichen und Zeilenumbrüche können nichts einschleusen', () => {
  const value = contentDisposition('attachment', 'a"b\\c\r\nX-Evil: 1.pdf');
  assert.doesNotMatch(value, /[\r\n]/);
  assert.match(value, /^attachment; filename="a_b_c__X-Evil: 1\.pdf"; /);
});
