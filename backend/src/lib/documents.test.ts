import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docTypeOf, inlineContentType, renameKeepingExtension } from './documents';
import { ApiError } from '../middleware/errors';

test('documents: PDFs und MP3s werden erkannt (auch Grossschreibung)', () => {
  assert.equal(docTypeOf('pdf', 'application/pdf'), 'pdf');
  assert.equal(docTypeOf('PDF', ''), 'pdf');
  assert.equal(docTypeOf('mp3', 'audio/mpeg'), 'audio');
  assert.equal(docTypeOf('mp3', 'application/octet-stream'), 'audio');
  assert.equal(docTypeOf('m4a', ''), 'audio');
  assert.equal(docTypeOf('jpg', 'image/jpeg'), 'image');
  assert.equal(docTypeOf('mp4', 'video/mp4'), 'video');
});

test('documents: unbekannte Endung fällt auf einen bekannten MIME-Typ zurück', () => {
  assert.equal(docTypeOf('bin', 'application/pdf'), 'pdf');
  assert.equal(docTypeOf('bin', 'audio/x-m4a'), 'audio');
  assert.equal(inlineContentType('bin', 'audio/x-m4a'), 'audio/mp4');
  assert.equal(inlineContentType('bin', 'audio/mpeg; charset=binary'), 'audio/mpeg');
});

test('documents: alles andere ist ein reiner Download', () => {
  assert.equal(
    docTypeOf('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    'file',
  );
  assert.equal(docTypeOf('zip', 'application/zip'), 'file');
  assert.equal(docTypeOf('bin', 'application/octet-stream'), 'file');
});

test('documents: HTML, SVG & Co. werden nie inline ausgeliefert', () => {
  assert.equal(inlineContentType('html', 'text/html'), null);
  assert.equal(inlineContentType('htm', 'text/html'), null);
  assert.equal(inlineContentType('svg', 'image/svg+xml'), null);
  assert.equal(inlineContentType('bin', 'image/svg+xml'), null);
  assert.equal(inlineContentType('js', 'text/javascript'), null);
  assert.equal(inlineContentType('xml', 'application/xml'), null);
  // Die Endung bestimmt den Typ – ein gefälschter MIME-Typ ändert daran nichts.
  assert.equal(inlineContentType('pdf', 'text/html'), 'application/pdf');
  assert.equal(docTypeOf('svg', 'image/svg+xml'), 'file');
});

test('documents: Umbenennen behält die Endung', () => {
  assert.equal(renameKeepingExtension('Track 01.mp3', 'Halleluja'), 'Halleluja.mp3');
  assert.equal(renameKeepingExtension('Track 01.mp3', 'Halleluja.mp3'), 'Halleluja.mp3');
  assert.equal(renameKeepingExtension('Noten.PDF', '  Ave   Maria  '), 'Ave Maria.PDF');
  assert.equal(renameKeepingExtension('ohne-endung', 'Neuer Name'), 'Neuer Name');
});

test('documents: Umbenennen entfernt Pfad- und Steuerzeichen', () => {
  assert.equal(renameKeepingExtension('a.pdf', '../../etc/passwd'), '.. .. etc passwd.pdf');
  assert.equal(renameKeepingExtension('a.pdf', 'Zeile\nZwei'), 'Zeile Zwei.pdf');
  assert.equal(renameKeepingExtension('a.pdf', 'a"b<c>d|e'), 'a b c d e.pdf');
});

test('documents: leere oder zu lange Namen werden abgelehnt', () => {
  assert.throws(() => renameKeepingExtension('a.pdf', '   '), ApiError);
  assert.throws(() => renameKeepingExtension('a.pdf', '.pdf'), ApiError);
  assert.throws(() => renameKeepingExtension('a.pdf', 'x'.repeat(151)), ApiError);
});
