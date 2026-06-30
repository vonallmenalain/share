# share · Fotos &amp; Videos privat teilen

Eine kleine, schöne App, um **Original-Fotos und -Videos** in einer privaten Gruppe
zu teilen – plattformübergreifend (iOS &amp; Android, über den Browser). Jede:r lädt
die eigenen Aufnahmen in einen **Bereich** (z.&nbsp;B. „Ferien Tessin“) hoch, alle
sehen eine übersichtliche Galerie, können nach Person oder chronologisch
filtern, die Galerie **selbst anordnen** und Originale wieder herunterladen.

Die Dateien liegen **lokal auf deinem QNAP** – kein Cloud-Speicher Dritter.

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
- **Schöne Galerie** mit drei Ansichten: *Galerie* (frei sortierbar per Drag &amp; Drop),
  *Nach Person* und *Chronologisch* (nach Aufnahmedatum).
- **Video-Wiedergabe in der App** über eine kleinere, gut streambare Vorschau;
  **Download** liefert immer das **Original**.
- **Download** einzeln oder als **ZIP** (mehrere/alle Originale auf einmal).
- **Lokale Speicherung** auf dem QNAP, Metadaten in einer einzelnen SQLite-Datei.

## Technik

- `frontend/`: React + Vite + TypeScript, gehostet auf **Netlify**.
- `backend/`: Node.js + Express + TypeScript, läuft als **Docker-Container** auf dem QNAP.
  - Bildvarianten mit **sharp**, Video-Poster/Vorschau mit **ffmpeg**.
  - **SQLite** (`better-sqlite3`) als lokale Metadaten-DB – keine externe Datenbank nötig.
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

> Eine kompakte Checkliste „Was muss ich zusätzlich zum Code selbst erstellen?“
> findest du am Ende von [docs/01-qnap.md](docs/01-qnap.md#checkliste).
