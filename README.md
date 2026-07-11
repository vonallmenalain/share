# share · Fotos, Videos &amp; mehr für die Gruppe

Eine kleine, schöne App, um **Original-Fotos und -Videos** in einer privaten Gruppe
zu teilen – plattformübergreifend (iOS &amp; Android, über den Browser). Jede:r lädt
die eigenen Aufnahmen in einen **Bereich** (z.&nbsp;B. „Ferien Tessin“) hoch, alle
sehen eine übersichtliche Galerie, können nach Person oder chronologisch
filtern, die Galerie **selbst anordnen** und Originale wieder herunterladen.

Aus der Foto-App ist eine allgemeine **Ferien- und Gruppen-App** geworden: Ein
Bereich kann optional zusätzliche **Module** aktivieren – **Finanzen**
(gemeinsame Ausgaben fair abrechnen), **Einkaufsliste**, **Notizen** (Text &amp;
Checklisten, auch mit Bildern) und einen **Kalender**. Fotos &amp; Videos sind
immer dabei; alle anderen Module sind pro Bereich frei wählbar. Bestehende
Bereiche bleiben unverändert (nur das Fotomodul aktiv) – nichts geht verloren.

Die Dateien liegen **lokal auf deinem QNAP** – kein Cloud-Speicher Dritter.
Alle Metadaten (auch der neuen Module) bleiben in derselben lokalen
**SQLite-Datei** – **keine externe Datenbank (z.&nbsp;B. Firebase) nötig**.

```
   ┌──────────────────────────┐        HTTPS         ┌────────────────────────────┐
   │  Familie / Gäste          │ ───────────────────▶ │  Netlify (Frontend)        │
   │  (Browser, iOS/Android)   │                      │  React-App  share.alae.app │
   └──────────────────────────┘                      └─────────────┬──────────────┘
                                                                    │ API (HTTPS)
                                                                    ▼
                                                      ┌────────────────────────────┐
                                        Cloudflare    │  Cloudflare Tunnel         │
                                       (kein offener  │  api.alae.app              │
                                        Port am NAS)  └─────────────┬──────────────┘
                                                                    ▼
                                                      ┌────────────────────────────┐
                                                      │  QNAP (Docker)             │
                                                      │  Backend-API + Bild-/Video-│
                                                      │  Verarbeitung (sharp/ffmpeg)│
                                                      │  Speicher: Freigabe „share“│
                                                      └────────────────────────────┘
```

---

## Funktionen

- **Bereiche (Spaces)** mit Link und optionalem Passwort. Link teilen → reinkommen → loslegen.
- **Einfacher Upload** von Fotos *und* Videos, auch viele auf einmal, per Klick oder Drag &amp; Drop.
- **Grosse Dateien / Videos**: Uploads werden in Teile (Chunks) zerlegt und sind
  **fortsetzbar** – ein abgebrochener Upload kann weiterlaufen (siehe
  [docs/05-uploads-und-videos.md](docs/05-uploads-und-videos.md)).
- **Upload-Fortschritt** wird während des Hochladens angezeigt – ein
  Gesamtbalken (nach Bytes) plus ein Balken pro Datei und eine Aufschlüsselung
  nach Fotos/Videos, damit man auch bei vielen Fotos oder grossen Videos sieht,
  wie weit es ist.
- **Schöne Galerie** mit drei Ansichten: *Galerie* (Foto-Collage mit
  unterschiedlich grossen Kacheln), *Nach Person* und *Chronologisch*
  (nach Aufnahmedatum). Beim Herunterscrollen blenden sich Navigationsleiste und
  Buttons aus („Vollbild-Modus“, nur die Fotos sind sichtbar) und erscheinen beim
  Hochscrollen wieder. Fotos werden standardmässig im Originalformat (an der
  EXIF-Orientierung ausgerichtet) angezeigt – Hochformat bleibt Hochformat.
- **Vorschaubild anpassen**: In der Foto-Ansicht lässt sich neben dem Stern der
  Ausschnitt des Vorschaubilds anpassen – Ausschnitt wählen, hinein-/herauszoomen
  und die Ansicht drehen. Das angepasste Vorschaubild erscheint in der Galerie und
  allen Ansichten; das Original bleibt unverändert und kann jederzeit
  wiederhergestellt werden.
- **Als App installieren (PWA)** – auch für einen einzelnen Bereich: Öffnet man
  einen Bereich (z. B. `share.alae.app/s/ferien-tessin-…`) und fügt ihn zum
  Startbildschirm hinzu, öffnet die installierte Verknüpfung direkt diesen Bereich
  statt der Startseite. Die installierte App heisst dabei **genau wie der Bereich**
  (z. B. „Ferien Tessin“) – der Name wird nicht mehr abgeschnitten.
- **Zwischen Bereichen wechseln**: Öffnet man nach und nach mehrere Bereiche per
  Link, merkt sich die App diese **nur lokal im Browser**. Über das Profil-Menü
  oben rechts sieht man dann, in welchem Bereich man gerade ist (z. B. „Ferien
  Tessin“), und kann mit einem Klick zu einem anderen **selbst besuchten**
  Bereich wechseln (z. B. „Ferien Frankreich 2026“). Es werden dabei ausschliesslich
  Bereiche angezeigt, deren Link man vorher selbst geöffnet hat – niemals alle
  vorhandenen Bereiche.
- **Video-Wiedergabe in der App** über eine kleinere, gut streambare Vorschau;
  **Download** liefert immer das **Original**. Hochformat-Videos werden mit dem
  richtigen Seitenverhältnis (Hochformat) angezeigt.
- **Löschen**: *Löschen* darf **jede Person mit Zugriff auf den Link** – egal,
  wer ein Medium hochgeladen hat. Das Medium verschwindet danach sofort aus
  allen Galerien und ist für die Nutzer:innen nirgends mehr sichtbar, wird aber
  nur ausgeblendet (die Datei bleibt auf dem QNAP). Nur der **Administrator**
  sieht gelöschte Medien weiterhin unter **Gelöscht** und kann sie dort
  **wiederherstellen** (dann erscheinen sie wieder in der Galerie) oder
  **endgültig löschen** – erst dabei wird die Datei auch vom QNAP entfernt.
- **Download** einzeln oder als **ZIP** (mehrere/alle Originale auf einmal).
- **Adminbereich**: aufklappbare Bereiche mit allen Medien aller Personen,
  inklusive der gelöschten – mit der Möglichkeit, wiederherzustellen oder
  Fotos/Videos endgültig zu löschen.
- **Zugriffsstatistik (nur Admin)**: Pro Bereich lässt sich nach dem Ausklappen
  ein Protokoll aller Zugriffe einsehen – mit Zeitpunkt, Person, IP und
  **Standort** (Stadt/Region/Land, wo verfügbar). Die Liste ist sortierbar und
  lässt sich pro **Tag**, **Standort**, **IP**, **Person** oder **Gerät**
  auswerten sowie als **CSV** exportieren. Alles bleibt in der lokalen SQLite-DB
  – **keine externe Datenbank (z. B. Firebase) nötig**. Die Standortdaten kommen
  gratis aus den Cloudflare-Geo-Headern (siehe
  [docs/02-cloudflare-tunnel.md](docs/02-cloudflare-tunnel.md#26-standort-header-für-die-zugriffsstatistik-optional-empfohlen)).
  Für normale Nutzer:innen ist davon **nichts** sichtbar.
- **Lokale Speicherung** auf dem QNAP, Metadaten in einer einzelnen SQLite-Datei.

## Module (optional pro Bereich)

Beim Erstellen eines Bereichs (und später im Adminbereich) lässt sich auswählen,
welche Module aktiv sind. **Fotos &amp; Videos** sind immer aktiviert und können
nicht deaktiviert werden. Ein deaktiviertes Modul wird nur ausgeblendet –
vorhandene Daten bleiben erhalten.

- **Finanzen** – Gemeinsame Ausgaben erfassen, **gleichmässig** (unter allen
  oder ausgewählten Personen) oder mit **manuellen Beträgen** aufteilen und mit
  möglichst **wenigen Ausgleichszahlungen** abrechnen („Peter zahlt Alain
  CHF 74.50“). Beträge werden **immer als ganzzahlige Rappen/Cents** gespeichert
  – keine Fliesskomma-Rechnung. Pro Bereich eine feste Währung (CHF, EUR, USD,
  GBP), keine automatische Umrechnung. Abrechnungen lassen sich abschliessen,
  Zahlungen als bezahlt markieren und bei Bedarf wieder öffnen.
- **Einkaufsliste** – Schnell etwas hinzufügen (Enter), optionale Menge, offene
  Einträge zuerst, Erledigtes in einem zuklappbaren Bereich, mobil gut bedienbar.
- **Notizen** – **Text-** und **Checklisten-Notizen**, anheftbar, mit
  **Bildanhängen** (nutzen dieselbe Upload-/Vorschau-Logik wie die Galerie;
  erscheinen aber **nicht** in der Fotogalerie). Autosave beim Tippen.
- **Kalender** – Kompakte Monatsansicht mit Tagesagenda, ganztägige oder
  zeitgebundene Termine, Ort und Beschreibung. Keine wiederkehrenden Termine,
  keine externe Kalender-Integration.

**Teilnehmer &amp; Identität:** Für Finanzen (und zur Zuordnung von Aktionen) gibt
es pro Bereich stabile **Teilnehmer**. Beim ersten Öffnen des Finanzbereichs
fragt die App „Wer bist du?“ – man wählt sich aus oder legt sich neu an. Die
Auswahl wird nur **lokal im Browser** gespeichert. Das ist bewusst ein
**Vertrauensmodell für Familie &amp; Freunde** – keine echte Benutzer-
Authentifizierung.

Alte geteilte Links, installierte PWAs und `/s/:slug` (öffnet weiterhin direkt
die Fotogalerie) funktionieren unverändert.

## Technik

- `frontend/`: React + Vite + TypeScript, gehostet auf **Netlify**.
- `backend/`: Node.js + Express + TypeScript, läuft als **Docker-Container** auf dem QNAP.
  - Bildvarianten mit **sharp**, Video-Poster/Vorschau mit **ffmpeg**.
  - **SQLite** (`better-sqlite3`) als lokale Metadaten-DB – keine externe Datenbank nötig.
  - Getrennte Router pro Modul (`participants`, `finance`, `shopping`, `notes`,
    `calendar`); die Finanzberechnung liegt als reine, getestete Funktion in
    `backend/src/lib/finance.ts` (`npm test`).
- `docker-compose.yml` für das QNAP (inkl. optionalem Cloudflare-Tunnel &amp; Auto-Update).
- GitHub Actions baut das Backend-Image automatisch nach GHCR.

## Projektstruktur

```
backend/    Express-API, Upload-/Datei-Logik, Bild-/Video-Verarbeitung
frontend/   React-App (Galerie, Upload, Lightbox)
docs/       Schritt-für-Schritt-Anleitungen (QNAP, Cloudflare, Netlify, Betrieb)
docker-compose.yml         Stack für das QNAP
docker-compose.build.yml   Override zum lokalen Bauen auf dem QNAP
.github/workflows/         Automatischer Image-Build
```

---

## Schnellstart (lokal testen)

Voraussetzungen: Node.js 22+, optional `ffmpeg` für Videos.

```bash
# Backend
cd backend
cp .env.example .env        # JWT_SECRET und ADMIN_KEY eintragen (beliebige Werte für lokal)
npm install
DATA_DIR=./data npm run dev # API auf http://localhost:4000
npm test                    # Unit-Tests der Finanzberechnung (optional)

# Frontend (zweites Terminal)
cd frontend
cp .env.example .env        # VITE_API_BASE_URL=http://localhost:4000
npm install
npm run dev                 # App auf http://localhost:5173
```

Dann im Browser `http://localhost:5173/new` öffnen, Admin-Schlüssel (dein
`ADMIN_KEY`) eingeben, einen Bereich erstellen und den Link teilen.

---

## Einrichtung in Produktion (share.alae.app)

Folge den Anleitungen in `docs/` in dieser Reihenfolge:

1. **[QNAP einrichten](docs/01-qnap.md)** – Backend-Container + Speicher auf der Freigabe „share“.
2. **[Cloudflare Tunnel](docs/02-cloudflare-tunnel.md)** – API sicher als `api.alae.app` veröffentlichen.
3. **[Netlify](docs/03-netlify.md)** – Frontend als `share.alae.app` hosten.
4. **[Betrieb &amp; Troubleshooting](docs/04-betrieb.md)** – Updates, Backups, häufige Fehler.
5. **[Uploads &amp; Videos – wie es funktioniert](docs/05-uploads-und-videos.md)** – Hintergrund zu grossen Dateien.
6. **[Module: Finanzen, Einkauf, Notizen &amp; Kalender](docs/06-module.md)** – die optionalen Bereichs-Module, Migration und neue API.

> Eine kompakte Checkliste „Was muss ich zusätzlich zum Code selbst erstellen?“
> findest du am Ende von [docs/01-qnap.md](docs/01-qnap.md#checkliste).
