# 5. Uploads &amp; Videos – wie es funktioniert

Dieses Dokument erklärt die Strategie hinter dem Hochladen grosser Dateien und
der Video-Wiedergabe – damit du verstehst, was passiert (und warum es robust ist).

## Chunked, fortsetzbare Uploads

Grosse Dateien (vor allem Videos) werden **nicht** in einem Rutsch hochgeladen,
sondern in **Teile (Chunks) zu je 5 MB** zerlegt:

1. **Session anlegen** – das Frontend meldet Dateiname, Typ und Grösse an. Das
   Backend legt eine Upload-Session an und antwortet mit der Chunk-Grösse, der
   Anzahl Chunks und der Liste der **bereits vorhandenen** Chunks.
2. **Chunks senden** – jeder Chunk geht als eigene, kleine HTTP-Anfrage hoch
   (`PUT …/chunks/<index>`). Dadurch bleibt jede Anfrage weit unter dem
   Cloudflare-Limit (~100 MB), und der Fortschritt ist fein sichtbar.
3. **Abschliessen** – sind alle Chunks da, fügt das Backend sie zur
   Originaldatei zusammen, prüft die Gesamtgrösse und stösst die Verarbeitung an.

### Was passiert bei Abbruch / Browser schliessen?

- **Einzelner Netzwerk-Fehler:** Der betroffene Chunk wird automatisch erneut
  versucht (über „Erneut“ in der Upload-Leiste). Bereits übertragene Chunks
  bleiben auf dem Server liegen.
- **Tab/Browser während des Uploads geschlossen:** Die fertig übertragenen
  Chunks bleiben serverseitig erhalten. Beim nächsten Besuch zeigt die App einen
  Hinweis „Unterbrochene Uploads gefunden“. Wählst du **dieselbe Datei** noch
  einmal über „Hochladen“ aus, erkennt der Server die offene Session und
  **überspringt die bereits vorhandenen Chunks** – der Upload läuft genau dort
  weiter, wo er abgebrochen ist.
  - Technischer Hintergrund: Browser dürfen ausgewählte Dateien aus
    Sicherheitsgründen **nicht** über einen Neustart hinweg behalten. Deshalb
    muss die Datei nach einem Browser-Neustart einmalig neu ausgewählt werden –
    erneut hochgeladen wird aber nur der fehlende Rest.
- **Aufräumen:** Unvollständige Sessions, die älter als
  `UPLOAD_SESSION_TTL_HOURS` (Standard 48 h) sind, werden automatisch entfernt.

### Parallelität

Es werden bis zu **3 Dateien gleichzeitig** hochgeladen; innerhalb einer Datei
laufen die Chunks der Reihe nach. Während des Uploads warnt der Browser, wenn man
die Seite verlassen will.

## Bildverarbeitung (sharp)

Aus jedem Foto entstehen serverseitig:

- ein **Thumbnail** (für die Galerie),
- eine grössere **Vorschau** (für die Lightbox).

Die EXIF-Ausrichtung wird berücksichtigt, das **Original bleibt unverändert** und
ist per „Original“-Download abrufbar.

## Videoverarbeitung (ffmpeg)

Aus jedem Video entstehen:

- ein **Poster** (Standbild) für die Galerie-Kachel,
- eine **kleinere, gut streambare Vorschau** (H.264/AAC, `faststart`, Höhe
  standardmässig max. 720 px) zum **Abspielen direkt in der App**.

Das **Original** wird nie verändert. Der **Download** liefert immer die
Originaldatei in voller Qualität.

Die Auslieferung von Vorschau und Original unterstützt **HTTP-Range-Requests**,
sodass Videos zügig starten und vor-/zurückgespult werden können.

> Während der Verarbeitung erscheint die Kachel mit einem kleinen Ladekreis und
> wird automatisch ersetzt, sobald die Vorschau fertig ist (die App fragt den
> Status im Hintergrund ab).

## Relevante Einstellungen (`.env`)

| Variable | Standard | Bedeutung |
|---|---|---|
| `UPLOAD_CHUNK_SIZE_BYTES` | `5242880` (5 MB) | Grösse eines Chunks |
| `UPLOAD_MAX_FILE_MB` | `5120` (5 GB) | Maximale Dateigrösse |
| `UPLOAD_SESSION_TTL_HOURS` | `48` | Aufräumzeit unvollständiger Uploads |
| `IMG_THUMB_MAX` / `IMG_PREVIEW_MAX` | `600` / `1800` | Kantenlänge der Bildvarianten |
| `VIDEO_PREVIEW_MAX_HEIGHT` | `720` | Höhe der Video-Vorschau |
| `VIDEO_PREVIEW_CRF` | `26` | Qualität der Video-Vorschau (kleiner = besser/grösser) |
| `VIDEO_PROCESSING` | `true` | Video-Poster/Vorschau erzeugen |
