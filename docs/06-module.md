# Module: Dokumente, Finanzen, Einkaufsliste, Notizen &amp; Kalender

Aus der Foto-Share-App ist eine allgemeine Ferien- und Gruppen-App geworden.
Ein Bereich kann eines oder mehrere der folgenden Module aktivieren. Alle
Daten bleiben in derselben lokalen **SQLite-Datei** auf dem QNAP – es kommt
**keine** zweite Datenbank und kein Firebase hinzu.

## Übersicht der Module

| Modul | Schlüssel | Zweck |
| --- | --- | --- |
| Fotos &amp; Videos | `photos` | Gemeinsame Galerie |
| Dokumente | `documents` | PDFs, Musik &amp; andere Dateien direkt ansehen/anhören |
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
- ergänzt `spaces.uploads_locked` (Upload-Sperre, Standard `0` = wie bisher
  offen) – siehe „Upload-Sperre" unten;
- ergänzt `spaces.documents_sections` (Reihenfolge der Abschnitte im
  Dokumente-Modul, Standard leer = Dokumente oben);
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

### Ohne Namensabfrage („Nicht nach einem Namen fragen“)

Beim Erstellen eines Bereichs (und später im Adminbereich) lässt sich die
Namensabfrage komplett abschalten (`spaces.skip_identity_prompt`, im API als
`skipIdentityPrompt`). Dann gilt für diesen Bereich:

- Nach dem Anklicken des Links geht es **direkt** ins Modul (z. B. in die
  Galerie) – ohne „Wer bist du?“ und ohne Namensfeld im Betreten-Formular. Ein
  **Passwort** wird weiterhin abgefragt; ohne Passwort entfällt jeder
  Zwischenschritt (`SpaceSessionContext` holt den Access-Token im Hintergrund).
- Es wird **keine Identität angelegt** und keine automatisch aufgelöst
  (`useParticipants` überspringt die Auflösung). Bereits vorhandene
  Teilnehmer bleiben erhalten und erscheinen wieder, sobald die Option
  deaktiviert wird.
- Beiträge (z. B. Uploads) laufen unter dem Namen, den das Gerät bereits kennt
  (`identityStore`), sonst unter **„Gast“** – der frühere Namens-Dialog vor dem
  ersten Upload entfällt hier (siehe `uploaderName` im `SpaceSessionContext`).
- Die Option schliesst den **Pflicht-Code** aus: Ohne Identität gibt es nichts,
  was ein Code schützen könnte. Das Backend setzt `require_participant_pin`
  deshalb auf `0`, sobald `skip_identity_prompt` gesetzt ist.

Bestehende Bereiche sind davon nicht betroffen: Die Spalte wird per Migration
mit `0` ergänzt, es bleibt also beim bisherigen Verhalten.

### Schutz-Code (PIN)

Jede Identität kann freiwillig mit einem **Code (PIN, 4–8 Ziffern)** geschützt
werden – nur so kann später jemand denselben Namen auf einem **weiteren
Gerät** wieder verwenden (auf demselben Gerät reicht die lokal gespeicherte
Auswahl, der Code wird nur einmal benötigt). Beim Erstellen eines Bereichs
lässt sich zusätzlich festlegen, dass der Code **Pflicht** ist
(`spaces.require_participant_pin`) – dann muss beim Anlegen einer neuen
Identität (oder beim erneuten Auswählen einer Identität ohne Code) zwingend
einer vergeben werden. Diese Einstellung lässt sich – wie „Nicht nach einem
Namen fragen“ – im Adminbereich jederzeit ändern
(`PATCH /api/spaces/:id/participant-policy`, Body `{ requireParticipantPin?:
boolean, skipIdentityPrompt?: boolean }`; nicht mitgeschickte Felder bleiben
unverändert).

**Code vergessen?** Da der Code nicht rückwärts auflösbar ist (bcrypt-Hash),
kann er nicht wiederhergestellt werden. Stattdessen kann der Administrator den
Code im Adminbereich (Bereich aufklappen → „Personen &amp; Codes verwalten“)
**zurücksetzen** (`POST /api/spaces/:id/participants/:participantId/reset-pin`).
Danach hat die Identität wieder keinen Code – die betroffene Person legt beim
nächsten Öffnen des Bereichs (erzwungen, falls der Code Pflicht ist) einfach
einen neuen fest.

**Identitäten verwalten (umbenennen / archivieren / löschen).** Im selben
Bereich („Personen &amp; Codes verwalten“) kann der Administrator eine Identität
nicht nur beim Code verwalten, sondern auch:

- **Umbenennen** (`PATCH /api/spaces/:id/participants/:participantId`, Body
  `{ "name": "..." }`, optional `{ "color": "..." }`) – ändert den
  Anzeigenamen (pro Bereich eindeutig, sonst `409`). Praktisch, um einen
  Tippfehler zu korrigieren, ohne dass die Person selbst am Gerät sein muss
  (dieselbe Person kann ihren eigenen Namen weiterhin über
  `PATCH /api/participants/:id` ändern). Die Finanzdaten bleiben unverändert;
  zusätzlich wird die **„Upload von …“-Zuschreibung** bestehender Fotos/Medien
  mitgezogen, damit sie weiterhin zum aktuellen Namen passt (siehe
  „Uploader-Name synchron halten“ unten).
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

### Duplikat zusammenlegen (zwei Identitäten derselben Person zu einer)

Das **Zusammenlegen** ist bewusst etwas **anderes** als das oben beschriebene
Finanz-Zusammenführen – die Begriffe dürfen nicht verwechselt werden:

| | Finanzen: zusammen rechnen (`/merge`) | Duplikat zusammenlegen (`/consolidate`) |
| --- | --- | --- |
| Zweck | zwei **verschiedene** Personen (z. B. Alain &amp; Annina) im Finanzbereich als eine Person rechnen | dieselbe Person hat **versehentlich zwei** Identitäten – bereinigen |
| Identitäten danach | **beide bleiben** bestehen | die doppelte wird **gelöscht**, es bleibt **eine** |
| Gespeicherte Daten | **unverändert** (nur Kanonisierung bei der Berechnung) | Verweise werden **umgeschrieben** |
| Umkehrbar | **ja** (auflösen) | **nein** |
| Wirkung | nur Finanzberechnung/-anzeige | **alle** Module |

Beim Zusammenlegen werden **alle** Verweise der Quell-Identität (der doppelten)
auf die Ziel-Identität (die zu behaltende) umgeschrieben und die Quelle danach
gelöscht – in **einer** Transaktion (`consolidateParticipants`):

- **Finanzen:** `finance_expenses.paid_by_participant_id` und
  `created_by_participant_id`, `finance_expense_splits.participant_id` sowie
  `finance_settlement_transfers.from/to_participant_id`. Haben **beide**
  Identitäten in derselben Ausgabe einen Anteil, werden die Anteile
  **zusammengezählt** (der PK `(expense_id, participant_id)` lässt keinen
  doppelten Anteil zu). Dabei entstehende **Selbst-Transfers** (Ziel → Ziel)
  werden entfernt.
- **Lose Verweise** ohne Fremdschlüssel: „erledigt/erstellt von“ in
  Einkaufsliste, Notizen, Kalender und Abrechnungs-Stapeln.
- **Fotos/Medien:** die „Upload von …“-Zuschreibung der Quelle wird auf den
  Namen des Ziels umgeschrieben (siehe „Uploader-Name synchron halten“ unten).
- **Finanz-Zusammenführungen** (`merged_into`), die auf die Quelle zeigten,
  werden auf das Ziel umgehängt; zeigte das Ziel selbst auf die Quelle, wird der
  Zeiger gelöst.

Der Endpunkt ist `POST
/api/spaces/:id/participants/:participantId/consolidate` mit Body
`{ "into": "<Ziel-Teilnehmer-ID>" }`; die Antwort enthält die aktualisierte
Ziel-Identität und `removedId` (die gelöschte Quelle). Ein Zusammenlegen mit
sich selbst oder in einen fremden Bereich wird mit `400` abgelehnt. Weil die
Quelle vollständig entfernt wird, ist dies – anders als das reine Löschen –
**auch dann möglich, wenn die (doppelte) Identität in Finanzdaten verankert
ist**; ihre Daten gehen dabei nicht verloren, sondern gehen an das Ziel über.

### Uploader-Name synchron halten

Fotos und Videos merken sich beim Upload den Namen der hochladenden Person als
**Freitext-Momentaufnahme** (`items.uploader_name`, angezeigt als „Upload von
…“). Anders als die Finanzdaten sind sie **nicht** per Fremdschlüssel an die
Identität gebunden – das Medien- und das Teilnehmer-Modul sind unabhängig.
Damit „Upload von …“ nach einer **Umbenennung** (durch die Person selbst oder
den Administrator) oder einem **Duplikat-Zusammenlegen** nicht auf dem alten
Namen stehen bleibt, gleicht `renameUploaderName` (in
`backend/src/lib/participants.ts`) die betroffenen Medien des Bereichs an:

- Umgeschrieben werden alle `items` (Galerie **und** Notiz-Anhänge) sowie noch
  **offene** `uploads`, deren `uploader_name` dem alten Namen entspricht.
- Der Abgleich ist **case-insensitiv** (`COLLATE NOCASE`) – Teilnehmernamen
  sind pro Bereich ohnehin eindeutig, so wird auch eine reine
  Schreibweisen-Korrektur (z. B. „alain“ → „Alain“) übernommen.
- Bei offenen Uploads bleibt `updated_at` **unangetastet**, damit das Aufräumen
  verwaister Upload-Sitzungen (`cleanupStaleUploads`) nicht verzögert wird;
  bereits **fertige** Uploads haben ihr `items`-Medium schon erzeugt und werden
  über dieses abgedeckt.

**Einmaliger Abgleich der Bestandsdaten.** Für Uploads, die vor dieser
laufenden Synchronisierung entstanden sind, gleicht `backfillUploaderNames` den
gesamten Bestand einmalig ab: Jeder gespeicherte Uploader-Name, der eine
bestehende Identität desselben Bereichs **case-insensitiv** trifft, sich aber in
der Schreibweise unterscheidet (z. B. „alain“ → „Alain“), wird auf deren
exakten aktuellen Namen gesetzt. Namen **ohne** passende Identität (z. B.
„Unbekannt“ oder eine vollständig umbenannte, nicht mehr existierende Person)
bleiben unangetastet – für Letztere gibt es keine verlässliche Zuordnung. Der
Abgleich läuft über `runUploaderNameBackfillOnce` **genau einmal** beim
Serverstart (per `app_meta`-Flag `uploader_name_backfill_v1` abgesichert, analog
zum EXIF-Masse-Backfill) und ist idempotent.

**Ausdrückliche Neuzuweisung (bereichsbezogen).** Für Fälle, in denen sich ein
gespeicherter Name gar **nicht** aus der Identität ableiten lässt – etwa ein
Kürzel wie „A", das für „Christiane" steht (es trifft die Ziel-Identität nicht
einmal case-insensitiv) – trägt `remapUploaderNames` eine feste Zuordnung nach:
Es bildet in einem über seinen Anzeigenamen (`spaces.name`) bestimmten Bereich
alte (Kurz-)Uploader-Namen auf gewünschte Identitätsnamen ab. Umgeschrieben
werden – wie bei `renameUploaderName` – alle `items` (Galerie **und**
Notiz-Anhänge) sowie noch offene `uploads`, deren `uploader_name` dem alten Namen
**exakt** (als ganze Zeichenkette, `COLLATE NOCASE`) entspricht; alles andere
bleibt unangetastet. Die Zuordnung ist bewusst auf den einen Bereich beschränkt,
damit ein gleichlautendes Kürzel in einem anderen Bereich nicht mitverändert
wird. Konkret gleicht `runFrankreichUploaderRemapOnce` **genau einmal** beim
Serverstart (per `app_meta`-Flag `uploader_remap_frankreich_2026_v1` abgesichert,
idempotent) im Bereich **„Ferien Frankreich 2026"** die Kürzel „S" → „Salome",
„F" → „Frank" und „A" → „Christiane" an. Danach hält die laufende
Synchronisierung (`renameUploaderName`) die Namen über die Identität aktuell.

Getestet in `backend/src/lib/participants.test.ts`.

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

## Dokumente

Das Dokumente-Modul ist für das Teilen von Dateien mit möglichst wenig
Drumherum gedacht – typischer Fall: ein paar PDFs (Noten, Texte, Programme) und
dazu passende MP3s.

- **Liste:** PDFs und andere Dokumente oben, Musik/Audio darunter (die
  Überschriften „Dokumente"/„Audio" erscheinen nur, wenn es beides gibt). Die
  Reihenfolge der beiden Abschnitte lässt sich unter „Bearbeiten" ändern, z. B.
  Audio zuerst – sie gilt für alle, die den Bereich öffnen. Pro
  Eintrag gibt es einen Download-Knopf; rechts neben dem Titel des Bereichs lädt
  **„Alles herunterladen"** alle Dateien als ZIP („Lieder DKA 2026.zip“) –
  für alle mit dem Link, auch bei Upload-Sperre.
- **PDF-Ansicht:** Ein Tippen öffnet das PDF im Vollbild. Gerendert wird mit
  **pdf.js** (wird erst beim ersten PDF nachgeladen), damit es überall gleich
  funktioniert – auch auf Android (kein eingebauter PDF-Viewer) und auf dem
  iPhone (dort zeigt ein eingebettetes PDF sonst nur die erste Seite). Zum
  nächsten bzw. vorherigen PDF geht es per **Wischen** nach links/rechts, über
  die **Pfeile** oben (am Desktop zusätzlich seitlich) oder die
  **Pfeiltasten**. Ein Tippen auf den **Titel** (mit kleinem Pfeil nach unten)
  öffnet die Liste aller Dokumente – bei vielen scrollbar – zum direkten
  Springen. Die Ansicht hat eine eigene URL (`?doc=<id>`), „Zurück" schliesst
  sie. Nachbar-PDFs werden im Hintergrund vorgeladen. Bilder und Videos öffnen
  in derselben Ansicht.
- **Zoomen** (PDFs und Bilder): mit zwei Fingern, per Doppeltippen (hinein bzw.
  zurück auf die ganze Breite) oder am Computer mit Ctrl + Mausrad bzw. dem
  Trackpad. Gezoomt wird in der Ansicht selbst, nicht die ganze Seite: Das
  Dokument wird grösser und lässt sich danach in alle Richtungen verschieben;
  Kopfzeile und Player bleiben gleich gross. Die sichtbaren Seiten rendern kurz
  danach schärfer nach (`frontend/src/pages/documents/usePinchZoom.ts`).
  Wischen blättert nur in der ganzen Breite zum nächsten Dokument – gezoomt
  verschiebt es den Ausschnitt.
- **Musik:** Ein Tippen auf eine Audiodatei spielt sie **sofort** ab, ein
  weiteres Tippen pausiert. Am Ende eines Liedes startet automatisch das
  **nächste** (nach dem letzten ist Schluss). Die schmale Player-Leiste unten
  (zurück, Play/Pause, weiter, Spulen) bleibt auch über der PDF-Ansicht
  sichtbar – Noten oder Texte lassen sich so lesen, während das Lied läuft. Ein
  Tippen auf den Titel im Player (oder den kleinen Pfeil nach oben daneben)
  klappt die **Playlist** nach oben auf: Dort lässt sich jedes Lied direkt
  wählen, ohne das offene PDF zu verlassen; danach klappt sie wieder zu
  (ebenso mit Escape oder einem Tippen daneben). Über die Media-Session-API
  funktionieren auch die Tasten auf dem Sperrbildschirm bzw. am Kopfhörer.
- **Andere Dateien** (z. B. Word, ZIP) werden beim Antippen heruntergeladen.

**Link eines reinen Dokumente-Bereichs.** Besteht ein Bereich **nur** aus dem
Dokumente-Modul, zeigt sein Link `/s/<slug>` direkt die Dokumente – ohne
Weiterleitung und ohne Zwischenschritt. Fragt der Bereich zusätzlich nicht nach
einem Namen, zeigt die Kopfzeile nur das Logo – ohne Profil-/Bereichsmenü. Der
Tab-Titel ist der Name des Bereichs. Früher wurden solche Bereiche als
`/d/<slug>` geteilt; diese Links leiten weiterhin auf `/s/<slug>` um. Neue
Links verwenden bewusst wieder `/s/`: Diese Form versteht auch eine ältere, auf
einem Gerät noch gespeicherte App-Version – mit `/d/` landete eine solche
Version auf der Startseite („Link oder Code einfügen"), siehe
[4. Betrieb](04-betrieb.md#app-updates-auf-den-geräten).

**Hochladen & Verwalten** (für alle, oder mit Upload-Sperre nur für den
Administrator): „Dateien hinzufügen" (oder Dateien auf die Seite ziehen). Die
Dateien werden **nacheinander** und nach Namen sortiert hochgeladen
(„2 …" vor „10 …"), damit die Reihenfolge stimmt. Unter „Bearbeiten" lassen sich
Einträge verschieben, umbenennen (die Endung bleibt erhalten) und löschen; die
Pfeile neben den Überschriften „Dokumente" und „Audio" tauschen die beiden
Abschnitte (gespeichert pro Bereich in `spaces.documents_sections`). Der
Administrator sieht dort auch gelöschte Dokumente und kann sie
wiederherstellen oder endgültig löschen. „Link teilen" öffnet das Teilen-Menü
des Geräts (bzw. kopiert den Link).

**Technik.** Dokumente sind Medien (`items`) mit `scope = 'document'` und
`kind = 'document'`. Sie nutzen denselben fortsetzbaren Chunk-Upload
(`POST /api/uploads` mit `scope: 'document'`) und dieselbe Ablage, werden aber
**nicht verarbeitet** (keine Varianten) und sind nach dem Upload sofort
verfügbar. Für Audio wird beim Abschluss die Spieldauer per `ffprobe` ermittelt
(mit Zeitlimit). Dokumente erscheinen nie in der Galerie. Zum Anzeigen gibt es
`GET /files/view/:id`: Die Datei wird **inline** ausgeliefert – aber nur für
sichere Medientypen (PDF, Audio, Bilder ohne SVG, Video), deren Content-Type der
Server selbst aus der Endung bestimmt (`backend/src/lib/documents.ts`). Alles
andere (z. B. HTML oder SVG) kommt nur als Download, damit nie eine hochgeladene
Datei als Webseite auf der API-Domain ausgeführt wird. Downloads enthalten den
Dateinamen jetzt zusätzlich nach RFC 5987, sodass auch Namen mit „–" oder
Emojis funktionieren.

**Link-Vorschau mit dem Namen des Bereichs.** WhatsApp &amp; Co. lesen beim
Teilen nur das HTML (ohne JavaScript). Für reine Dokumente-Bereiche zeigt die
Vorschau das Dokumente-Bild (`og-docs.png`), darunter den **Namen des
Bereichs** (z. B. „Lieder DKA 2026") und **keine Beschreibung** – ohne Bezug zur
Foto-App. Das erledigt die Netlify Edge Function
`frontend/netlify/edge-functions/link-preview.ts`: Sie läuft für `/s/*` und
`/d/*`, aber nur für Vorschau-Programme (WhatsApp, iMessage, Telegram, Signal,
Facebook, Slack, Suchmaschinen …) – Browser laufen ohne Umweg durch. Sie
schlägt den Bereich beim Backend nach (`GET /api/spaces/by-slug/:slug`, mit
`VITE_API_BASE_URL`, sonst `https://api.alae.app`; höchstens 2,5 s) und passt
nur bei reinen Dokumente-Bereichen Titel und Bild an. Ist das Backend nicht
erreichbar, kommt die normale Seite. Die HTML-Anpassung selbst steckt in
`frontend/netlify/shared/linkPreview.ts` (Tests: `npm test` im Ordner
`frontend`). Für früher geteilte `/d/`-Links entsteht beim Build zusätzlich
`d/index.html` mit dem Titel „Dokumente" als Rückfall (Regel
`/d/*  /d/index.html  200` in `frontend/public/_redirects`).

## Upload-Sperre (reiner Ansichtslink)

Pro Bereich lässt sich beim Erstellen (und später im Adminbereich unter
„Hochladen") festlegen: **„Nur ich (Admin) darf Dateien hochladen"**
(`spaces.uploads_locked`, im API `uploadsLocked`). Dann gilt für alle anderen
mit dem Link:

- **Galerie:** ansehen, Videos abspielen, herunterladen, teilen – aber nicht
  hochladen, löschen, Favoriten setzen oder Vorschaubilder anpassen.
- **Dokumente:** ansehen, anhören, herunterladen – aber nicht hochladen,
  löschen, sortieren oder umbenennen.
- Notiz-Bilder gehören zum gemeinsamen Bearbeiten einer Notiz und sind nicht
  betroffen.

Der **Administrator** wird am Admin-Schlüssel erkannt, der beim Anlegen eines
Bereichs bzw. beim Anmelden im Adminbereich auf seinem Gerät gespeichert wird.
Die Bereichsseiten prüfen ihn einmal (`GET /api/spaces/admin-check`) und
blenden nur dann die Werkzeuge ein; Änderungen schicken ihn als Header
`X-Admin-Key` mit. Das Backend erzwingt die Sperre unabhängig von der
Oberfläche (`backend/src/middleware/manage.ts`). Ein mitgeschickter, aber
falscher Schlüssel wird mit `401` abgelehnt und läuft durch denselben
Rate-Limiter wie die Admin-Endpunkte – der Schlüssel lässt sich darüber also
nicht durchprobieren. Ohne Sperre bleibt alles wie bisher.

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

**Dokumente** (ändernde Endpunkte: mit Upload-Sperre nur mit `X-Admin-Key`)

- `GET /api/documents` – aktive Dokumente in Reihenfolge (inkl. `docType`:
  `pdf` | `audio` | `image` | `video` | `file`) und `sections`, die Reihenfolge
  der Abschnitte (z. B. `["audio", "docs"]`)
- `GET /api/documents/deleted` – gelöschte Dokumente (nur Admin)
- `GET /api/documents/zip` – alle aktiven Dokumente als ZIP (gestreamt, ohne
  Kompression; als Download-Link mit `?token=`)
- `PATCH /api/documents/order` – Body `{ "order": ["<id>", …] }`
- `PATCH /api/documents/sections` – Reihenfolge der Abschnitte, Body
  `{ "order": ["audio", "docs"] }`
- `PATCH /api/documents/:id` – umbenennen, Body `{ "name": "..." }`
- `POST /api/documents/:id/delete` – weich löschen
- Hochladen über `POST /api/uploads` mit `scope: 'document'`
- `GET /files/view/:id` – Datei zum Anzeigen/Abspielen (inline, nur sichere Typen)

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
- `PATCH /api/spaces/:id/upload-policy` – Upload-Sperre ein-/ausschalten
  (`{ "uploadsLocked": true | false }`).
- `GET /api/spaces/admin-check` – prüft nur den Admin-Schlüssel (für die
  Werkzeuge auf den Bereichsseiten).
- `GET /api/spaces/:id/participants` – alle Identitäten eines Bereichs
  (inkl. archivierter).
- `PATCH /api/spaces/:id/participants/:participantId` – Identität umbenennen
  (`{ "name": "..." }`, optional `{ "color": "..." }`); Name pro Bereich
  eindeutig, sonst `409`.
- `POST /api/spaces/:id/participants/:participantId/reset-pin` – Code einer
  Identität entfernen (Antwort auf „Code vergessen?“).
- `POST /api/spaces/:id/participants/:participantId/archive` – Identität
  archivieren (`{ "archived": true }`) oder wieder aktivieren
  (`{ "archived": false }`).
- `POST /api/spaces/:id/participants/:participantId/merge` – Identität im
  Finanzbereich mit einer primären Identität zusammenführen (`{ "into": "<id>" }`)
  oder die Zusammenführung auflösen (`{ "into": null }`) – **umkehrbar**, ändert
  keine gespeicherten Daten.
- `POST /api/spaces/:id/participants/:participantId/consolidate` – doppelte
  Identität derselben Person **endgültig** in eine andere zusammenlegen
  (`{ "into": "<Ziel-id>" }`); überträgt alle Daten und löscht die Quelle.
- `DELETE /api/spaces/:id/participants/:participantId` – Identität endgültig
  löschen (nur, wenn sie nicht in Finanzdaten verankert ist; sonst `409`).

## Umgebungsvariablen

Es sind **keine** neuen Umgebungsvariablen nötig. Alles nutzt die bestehende
Konfiguration (`DATA_DIR`, `JWT_SECRET`, `ADMIN_KEY`, …).
