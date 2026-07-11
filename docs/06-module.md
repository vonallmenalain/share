# Module: Finanzen, Einkaufsliste, Notizen &amp; Kalender

Aus der Foto-Share-App ist eine allgemeine Ferien- und Gruppen-App geworden.
Ein Bereich kann neben **Fotos &amp; Videos** (immer aktiv) optional weitere
Module aktivieren. Alle Daten bleiben in derselben lokalen **SQLite-Datei** auf
dem QNAP – es kommt **keine** zweite Datenbank und kein Firebase hinzu.

## Übersicht der Module

| Modul | Schlüssel | Zweck |
| --- | --- | --- |
| Fotos &amp; Videos | `photos` | Bestehende Galerie (immer aktiv, unveränderbar) |
| Finanzen | `finance` | Ausgaben erfassen, aufteilen, abrechnen |
| Einkaufsliste | `shopping` | Gemeinsame Liste zum Abhaken |
| Notizen | `notes` | Text-/Checklisten-Notizen mit Bildanhängen |
| Kalender | `calendar` | Termine der Gruppe (Monatsansicht + Agenda) |

Module werden beim **Erstellen** eines Bereichs gewählt und im **Adminbereich**
(Bereich aufklappen → „Module“) geändert. Ein deaktiviertes Modul wird nur
ausgeblendet – vorhandene Daten bleiben erhalten. `photos` kann nie deaktiviert
werden.

## Datenbankmigration

Die Migration läuft automatisch beim Serverstart (`initDb()` → `migrate()`), ist
**idempotent** (beliebig oft ausführbar) und erhält alle bestehenden Daten. Bei
einem Fehler bricht der Serverstart mit einer klaren Meldung ab, statt mit halb
ausgeführter Migration weiterzulaufen.

Die Migration:

- ergänzt fehlende Spalten `items.scope` und `uploads.scope` (Standard
  `'gallery'`) sowie eine optionale `note_id`-Zuordnung;
- setzt bestehende Medien auf `scope = 'gallery'` (Galerie bleibt unverändert);
- legt die neuen Tabellen an (`space_modules`, `space_finance_settings`,
  `participants`, `finance_expenses`, `finance_expense_splits`,
  `finance_settlement_batches`, `finance_settlement_expenses`,
  `finance_settlement_transfers`, `shopping_items`, `notes`,
  `note_checklist_items`, `note_attachments`, `calendar_events`);
- trägt bei **allen bestehenden Bereichen** das Fotomodul (`photos`) ein;
- erstellt Indizes (u. a. auf `space_id`, `status`, `expense_date`, `note_id`,
  `checked`, `start_at`, `deleted_at`).

Zusammengehörige Änderungen (neue Tabellen + Modul-Backfill) laufen in einer
SQLite-Transaktion.

## Teilnehmer &amp; Identität

Für Finanzen (und zur Zuordnung von Aktionen) gibt es pro Bereich stabile
**Teilnehmer** (`participants`). Beim ersten Öffnen des Finanzbereichs fragt die
App „Wer bist du?“ – man wählt sich aus oder legt sich neu an. Die Auswahl wird
pro Bereich **lokal im Browser** gespeichert (`share.participant.<slug>`) und bei
Modulaktionen über den Header `X-Participant-Id` mitgeschickt. Das Backend prüft
immer, dass die Teilnehmer-ID zum aktuellen Bereich (`req.spaceId`) gehört.

Das ist bewusst ein **Vertrauensmodell für Familie &amp; Freunde** – **keine**
echte Benutzer-Authentifizierung. Teilnehmernamen sind pro Bereich (ohne
Beachtung der Gross-/Kleinschreibung) eindeutig. Verwendete Teilnehmer werden
nicht gelöscht, sondern nur **archiviert**.

## Finanzberechnung

Die gesamte Logik liegt als reine, getestete Funktionen in
`backend/src/lib/finance.ts` (Tests: `backend/src/lib/finance.test.ts`,
`npm test`). Es wird **ausschliesslich mit ganzzahligen Rappen/Cents** gerechnet.

- **Aufteilung:** gleichmässig (unter allen oder ausgewählten Personen) oder
  manuelle Beträge. Bei gleichmässiger Aufteilung wird der nicht teilbare Rest
  deterministisch anhand der **sortierten Teilnehmer-IDs** verteilt (die ersten
  Personen bekommen je +1 Rappen). Die Summe der Anteile entspricht immer exakt
  dem Betrag.
- **Saldo je Person:** `bezahlt − eigener Anteil`. Positiv = erhält Geld,
  negativ = schuldet Geld. Die Summe aller Salden ist exakt null.
- **Ausgleichszahlungen:** Der jeweils grösste Schuldner wird mit dem grössten
  Gläubiger abgeglichen (greedy). Ergebnis: möglichst wenige Transfers, Summe
  der Transfers = Summe der Schulden, alles in Integer-Rappen.
- **Abrechnung abschliessen** (in einer Transaktion): offene Ausgaben laden →
  Salden berechnen → Batch anlegen → Ausgaben zuordnen → Transfers speichern →
  Ausgaben auf `settled` setzen. **Wiederöffnen** markiert den Batch als
  `reopened_at` und setzt die zugeordneten Ausgaben zurück auf `open`.
- Eine bereits abgerechnete Ausgabe kann nicht mehr verändert werden; gelöschte
  Ausgaben werden nur **soft-deleted**.

## Notiz-Bildanhänge

Bilder in Notizen nutzen dieselbe fortsetzbare **Chunk-Upload-**, Thumbnail-,
Preview- und Original-Logik wie die Galerie. Sie werden mit `scope = 'note'`
gespeichert und mit der Notiz verknüpft (`note_attachments`). Wichtig:

- `/api/items` (Galerie) liefert **nur** `scope = 'gallery'` – Notizbilder
  erscheinen nicht in der Galerie.
- Datei-Endpunkte (`/files/...`) bleiben über den bestehenden Space-Token
  geschützt.
- Beim Löschen einer Notiz (oder eines Anhangs) wird das Medium **soft-deleted**;
  die Originaldatei auf dem QNAP bleibt erhalten.

## Neue API-Endpunkte

Alle Endpunkte sind mit `requireSpace` geschützt und auf `req.spaceId`
eingeschränkt. Modulrouten prüfen zusätzlich, ob das Modul aktiviert ist
(`requireEnabledModule`).

**Teilnehmer**

- `GET /api/participants`
- `POST /api/participants`
- `PATCH /api/participants/:id`
- `POST /api/participants/:id/archive`

**Finanzen**

- `GET /api/finance/summary`
- `GET /api/finance/expenses`
- `POST /api/finance/expenses`
- `PATCH /api/finance/expenses/:id`
- `DELETE /api/finance/expenses/:id`
- `GET /api/finance/settlements`
- `POST /api/finance/settlements/preview`
- `POST /api/finance/settlements`
- `POST /api/finance/settlements/:id/reopen`
- `PATCH /api/finance/settlements/:batchId/transfers/:transferId`

**Einkaufsliste**

- `GET /api/shopping`
- `POST /api/shopping`
- `PATCH /api/shopping/:id`
- `POST /api/shopping/:id/toggle`
- `DELETE /api/shopping/:id`

**Notizen**

- `GET /api/notes`
- `POST /api/notes`
- `GET /api/notes/:id`
- `PATCH /api/notes/:id`
- `DELETE /api/notes/:id`
- `POST /api/notes/:id/checklist`
- `PATCH /api/notes/:id/checklist/:itemId`
- `DELETE /api/notes/:id/checklist/:itemId`
- `DELETE /api/notes/:id/attachments/:itemId`
- Bild-Uploads über `POST /api/uploads` mit `scope: 'note'` und `noteId`.

**Kalender**

- `GET /api/calendar/events?from=...&to=...`
- `POST /api/calendar/events`
- `PATCH /api/calendar/events/:id`
- `DELETE /api/calendar/events/:id`

**Adminbereich (Module)**

- `GET /api/spaces/:id/modules`
- `PATCH /api/spaces/:id/modules`

## Umgebungsvariablen

Es sind **keine** neuen Umgebungsvariablen nötig. Alles nutzt die bestehende
Konfiguration (`DATA_DIR`, `JWT_SECRET`, `ADMIN_KEY`, …).
