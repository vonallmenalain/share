# Module: Finanzen, Einkaufsliste, Notizen &amp; Kalender

Aus der Foto-Share-App ist eine allgemeine Ferien- und Gruppen-App geworden.
Ein Bereich kann eines oder mehrere der folgenden Module aktivieren. Alle
Daten bleiben in derselben lokalen **SQLite-Datei** auf dem QNAP – es kommt
**keine** zweite Datenbank und kein Firebase hinzu.

## Übersicht der Module

| Modul | Schlüssel | Zweck |
| --- | --- | --- |
| Fotos &amp; Videos | `photos` | Gemeinsame Galerie |
| Finanzen | `finance` | Ausgaben erfassen, aufteilen, abrechnen |
| Einkaufsliste | `shopping` | Gemeinsame Liste zum Abhaken |
| Notizen | `notes` | Text-/Checklisten-Notizen mit Bildanhängen |
| Kalender | `calendar` | Termine der Gruppe (Monatsansicht + Agenda) |

Module werden beim **Erstellen** eines Bereichs gewählt und im **Adminbereich**
(Bereich aufklappen → „Module“) geändert. Ein deaktiviertes Modul wird nur
ausgeblendet – vorhandene Daten bleiben erhalten. **Fotos &amp; Videos
(Galerie) sind seit Einführung der Modulauswahl ein Modul wie jedes andere und
können ebenfalls abgewählt werden** – z. B. für einen reinen Finanz-Bereich.
Es muss aber immer **mindestens ein Modul** aktiv bleiben. Ist die Galerie
nicht aktiviert, öffnet ein Bereich direkt beim ersten aktivierten anderen
Modul statt bei der (nicht existierenden) Galerie. Bereiche, die von **vor**
der Modul-Einführung stammen und noch keinen `space_modules`-Eintrag für
`photos` haben, bleiben aus Kompatibilitätsgründen weiterhin mit aktiver
Galerie.

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

Zur Zuordnung von Aktionen (Finanzen, Einkaufsliste, Notizen, Kalender – auch
bei reinen Foto-Bereichen) gibt es pro Bereich stabile **Teilnehmer**
(`participants`). „Wer bist du?“ ist **app-weit**: Beim ersten Öffnen eines
beliebigen Links innerhalb eines Bereichs (auf einem Gerät) fragt die App
einmalig danach – man wählt sich aus oder legt sich neu an. Die Abfrage sitzt
zentral in `SpaceLayout`/`SpaceSessionContext` (nicht mehr pro Modul) und
blockiert den restlichen Inhalt, bis eine Identität gewählt ist.

Die Auswahl wird pro Bereich **lokal im Browser** gespeichert
(`share.participant.<slug>`) und bei Modulaktionen über den Header
`X-Participant-Id` mitgeschickt. Das Backend prüft immer, dass die
Teilnehmer-ID zum aktuellen Bereich (`req.spaceId`) gehört.

Das ist bewusst ein **Vertrauensmodell für Familie &amp; Freunde** – **keine**
echte Benutzer-Authentifizierung. Teilnehmernamen sind pro Bereich (ohne
Beachtung der Gross-/Kleinschreibung) eindeutig. Verwendete Teilnehmer werden
nicht gelöscht, sondern nur **archiviert**.

### Schutz-Code (PIN)

Jede Identität kann freiwillig mit einem **Code (PIN, 4–8 Ziffern)** geschützt
werden – nur so kann später jemand denselben Namen auf einem **weiteren
Gerät** wieder verwenden (auf demselben Gerät reicht die lokal gespeicherte
Auswahl, der Code wird nur einmal benötigt). Beim Erstellen eines Bereichs
lässt sich zusätzlich festlegen, dass der Code **Pflicht** ist
(`spaces.require_participant_pin`) – dann muss beim Anlegen einer neuen
Identität (oder beim erneuten Auswählen einer Identität ohne Code) zwingend
einer vergeben werden. Diese Einstellung lässt sich im Adminbereich jederzeit
ändern (`PATCH /api/spaces/:id/participant-policy`).

**Code vergessen?** Da der Code nicht rückwärts auflösbar ist (bcrypt-Hash),
kann er nicht wiederhergestellt werden. Stattdessen kann der Administrator den
Code im Adminbereich (Bereich aufklappen → „Personen &amp; Codes verwalten“)
**zurücksetzen** (`POST /api/spaces/:id/participants/:participantId/reset-pin`).
Danach hat die Identität wieder keinen Code – die betroffene Person legt beim
nächsten Öffnen des Bereichs (erzwungen, falls der Code Pflicht ist) einfach
einen neuen fest.

**Identitäten verwalten (archivieren / löschen).** Im selben Bereich
(„Personen &amp; Codes verwalten“) kann der Administrator eine Identität nicht
nur beim Code verwalten, sondern auch:

- **Archivieren** (`POST /api/spaces/:id/participants/:participantId/archive`,
  Body `{ "archived": true | false }`) – die Person wird überall ausgeblendet
  (nicht mehr auswählbar, nicht mehr in Finanzlisten), **alle Finanzdaten
  bleiben aber erhalten und korrekt**. Über denselben Endpunkt mit
  `archived: false` lässt sie sich wieder aktivieren.
- **Endgültig löschen** (`DELETE
  /api/spaces/:id/participants/:participantId`) – entfernt den Datensatz
  unwiderruflich. Das gelingt **nur, wenn die Person nicht in Finanzdaten
  verankert ist** (weder als Zahler:in oder Ersteller:in einer Ausgabe, noch in
  einem Ausgaben-Anteil oder einer Ausgleichszahlung). Ist sie es doch, wird das
  Löschen mit `409` abgelehnt – dort würde die Abrechnung sonst nicht mehr
  stimmen; in diesem Fall bleibt das Archivieren als sichere Alternative. Lose
  Verweise ohne echte Verankerung (z. B. „erstellt von“ in Einkaufsliste,
  Notizen, Kalender oder Abrechnungs-Stapeln) werden beim Löschen automatisch
  gelöst. Zeigen andere (zusammengeführte) Identitäten auf diese Person, werden
  sie dabei wieder eigenständig.

### Identitäten zusammenführen (im Finanzbereich als eine Person)

Zwei Identitäten desselben Bereichs lassen sich im Adminbereich („Personen &amp;
Codes verwalten“ → „Zusammenführen mit…“) zu **einer Person** zusammenführen –
z. B. **Alain** und **Annina** als gemeinsamer Haushalt. Danach:

- erscheinen sie im Finanzbereich als **eine Instanz** (Anzeige „Alain +
  Annina“) statt als zwei getrennte Personen;
- werden ihre **Salden gemeinsam** gerechnet: Was die eine bezahlt und die
  andere schuldet, verrechnet sich innerhalb der Gruppe;
- zählen sie beim **gleichmässigen Aufteilen genau einmal** (der Betrag wird
  durch die Zahl der Gruppen geteilt, nicht der Einzelpersonen).

Technisch trägt die sekundäre Identität einen Zeiger `participants.merged_into`
auf die **primäre** Identität. Die Zusammenführung wirkt ausschliesslich über
eine **Kanonisierung** bei Berechnung und Anzeige (`loadMergeMap` /
`canonicalizeExpenses`) – die gespeicherten Ausgaben, Anteile und
Ausgleichszahlungen werden **nicht** umgeschrieben. Neu erfasste Ausgaben werden
serverseitig direkt auf die primäre Identität kanonisiert; bereits vor der
Zusammenführung erfasste Ausgaben werden bei der Berechnung mit einbezogen. Die
Zusammenführung ist **umkehrbar** („Zusammenführung auflösen“, `into: null`) und
verliert dabei **keine Finanzdaten**. Um Ketten zu vermeiden, muss das Ziel eine
eigenständige (nicht bereits zusammengeführte) Identität sein; bisher auf die
Quelle zeigende Identitäten werden mit auf das Ziel umgehängt (maximal eine
Ebene).

Der Endpunkt dafür ist `POST
/api/spaces/:id/participants/:participantId/merge` mit Body
`{ "into": "<primäre Teilnehmer-ID>" }` (bzw. `{ "into": null }` zum Auflösen).

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
- `POST /api/participants/:id/verify-pin`
- `PATCH /api/participants/:id/pin`
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

**Adminbereich (Module &amp; Teilnehmer)**

- `PATCH /api/spaces/:id/name` – Bereich umbenennen (`{ "name": "..." }`); der
  Link (Slug) wird dabei aus dem neuen Namen neu erzeugt, bestehende Links auf
  den alten Namen funktionieren danach nicht mehr.
- `GET /api/spaces/:id/modules`
- `PATCH /api/spaces/:id/modules`
- `PATCH /api/spaces/:id/participant-policy` – Code (PIN) für neue Identitäten
  zur Pflicht machen oder wieder freiwillig machen.
- `GET /api/spaces/:id/participants` – alle Identitäten eines Bereichs
  (inkl. archivierter).
- `POST /api/spaces/:id/participants/:participantId/reset-pin` – Code einer
  Identität entfernen (Antwort auf „Code vergessen?“).
- `POST /api/spaces/:id/participants/:participantId/archive` – Identität
  archivieren (`{ "archived": true }`) oder wieder aktivieren
  (`{ "archived": false }`).
- `POST /api/spaces/:id/participants/:participantId/merge` – Identität mit einer
  primären Identität zusammenführen (`{ "into": "<id>" }`) oder die
  Zusammenführung auflösen (`{ "into": null }`).
- `DELETE /api/spaces/:id/participants/:participantId` – Identität endgültig
  löschen (nur, wenn sie nicht in Finanzdaten verankert ist; sonst `409`).

## Umgebungsvariablen

Es sind **keine** neuen Umgebungsvariablen nötig. Alles nutzt die bestehende
Konfiguration (`DATA_DIR`, `JWT_SECRET`, `ADMIN_KEY`, …).
