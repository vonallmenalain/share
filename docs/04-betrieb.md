# 4. Betrieb &amp; Troubleshooting

## Bereiche verwalten

- **Neu erstellen:** `share.alae.app/new`, Admin-Schlüssel (`ADMIN_KEY`) eingeben,
  Name (z.&nbsp;B. „Ferien Tessin“) und optional ein Passwort vergeben. Du erhältst
  einen teilbaren Link `share.alae.app/s/<slug>`.
- **Übersicht / Löschen:** `share.alae.app/admin`. Beim Löschen eines Bereichs
  werden **alle** zugehörigen Dateien auf dem QNAP entfernt.

## Updates

```bash
cd /share/.../share-app
docker compose pull backend && docker compose up -d backend
```

Oder Auto-Updates mit Watchtower: `docker compose --profile autoupdate up -d`.

## Backups

Sichere den App-Datenordner (`.../share-app/data`). Er enthält Fotos, Videos und
die SQLite-DB. Tipp: QNAP **Hybrid Backup Sync**.

## Häufige Fehler

| Symptom | Ursache / Lösung |
|---|---|
| „Failed to fetch“ beim Öffnen/Upload | `VITE_API_BASE_URL` (Netlify) falsch, oder `PUBLIC_APP_URL` (Backend) passt nicht → CORS. Beide prüfen, Netlify neu deployen. |
| Upload bricht bei grossen Dateien ab | Normalerweise kein Problem (Chunks). Falls doch: `UPLOAD_CHUNK_SIZE_BYTES` ≤ 90 MB lassen (Cloudflare-Limit). Upload lässt sich fortsetzen (Datei erneut auswählen). |
| Videos spielen nicht ab | Im Container-Log steht „ffmpeg NICHT gefunden“. Offizielles Image nutzen (enthält ffmpeg) oder `VIDEO_PROCESSING=true` lassen. Download des Originals geht immer. |
| Datei zu gross | `UPLOAD_MAX_FILE_MB` erhöhen (Standard 5120 = 5 GB) und Backend neu starten. |
| „Zugang abgelaufen“ | Der Bereichs-Token ist abgelaufen (`ACCESS_TOKEN_TTL_DAYS`, Standard 60 Tage). Einfach Link erneut öffnen / Passwort erneut eingeben. |
| Neue Bereiche lassen sich nicht anlegen | Falscher `ADMIN_KEY`. Wert in `.env` prüfen. |

## Logs ansehen

```bash
docker compose logs -f backend
docker compose logs -f cloudflared
```

## Health-Check

```bash
curl https://api.alae.app/health      # {"ok":true,...}
```

## Sicherheit / Datenschutz

- Mediendateien werden nur mit gültigem **Bereichs-Token** ausgeliefert (im
  Link/Query enthalten). Wer den Link (und ggf. das Passwort) hat, sieht den
  Bereich – das ist gewollt („mit einer eingeschränkten Gruppe teilen“).
- Originale verlassen das QNAP nicht – sie werden nur auf direkte Anfrage
  gestreamt/heruntergeladen.
- Für maximale Vorsicht kannst du in Cloudflare Zero Trust zusätzlich
  **Access**-Policies vor `api.alae.app` legen.

➡️ Hintergrund zu grossen Uploads &amp; Videos: **[5. Uploads &amp; Videos](05-uploads-und-videos.md)**.
