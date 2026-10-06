# 4. Betrieb &amp; Troubleshooting

## Bereiche verwalten

- **Neu erstellen:** `share.alae.app/new` (oder Startseite → „Login" →
  „+ Neuer Bereich"), mit dem Admin-Schlüssel (`ADMIN_KEY`) anmelden,
  Name (z.&nbsp;B. „Ferien Tessin“) und optional ein Passwort vergeben. Du erhältst
  einen teilbaren Link `share.alae.app/s/<slug>`.
- **Link kopieren:** In der Übersicht (`share.alae.app/admin`) hat jeder Bereich
  rechts einen Knopf „Link kopieren“ – auch eingeklappt, ohne ihn zu öffnen.
- **Übersicht / Löschen:** `share.alae.app/admin`. Beim Löschen eines Bereichs
  werden **alle** zugehörigen Dateien auf dem QNAP entfernt.

## Updates

```bash
cd /share/.../share-app
docker compose pull backend && docker compose up -d backend
```

Oder Auto-Updates mit Watchtower: `docker compose --profile autoupdate up -d`.

## App-Updates auf den Geräten

Die App ist eine PWA mit Service Worker. Seitenaufrufe (Link öffnen, neu laden)
kommen **immer zuerst aus dem Netz** – ein geteilter Link zeigt also sofort die
aktuelle App, auch wenn auf dem Gerät noch eine ältere Version gespeichert ist.
Nur ohne Netz startet die gespeicherte App. Wird im Hintergrund eine neue
Version aktiv, lädt eine offene Seite nur dann neu, wenn sie selbst noch eine
ältere Version zeigt (Vergleich mit `/version.json`) – eine laufende Wiedergabe
wird also nicht unterbrochen.

Bis Oktober 2026 kam die App zuerst aus dem Speicher des Geräts. Ist auf einem
Gerät noch eine solche ältere Version gespeichert, startet der nächste Link
einmalig noch mit ihr und wechselt nach wenigen Sekunden von selbst zur neuen. Die alte Version kennt Links der Form `/d/<bereich>` nicht
und zeigt dafür die Startseite („Link oder Code einfügen") – deshalb werden
Bereiche wieder als `/s/<bereich>` geteilt. Wer einen `/d/`-Link bekommen hat
und auf der Startseite landet: Link einfach nochmals öffnen.

### Installierte App (Startbildschirm)

Wer die App oder einen Bereich auf Android zum Startbildschirm hinzugefügt hat,
hat eine kleine eigene App auf dem Gerät. Links auf share.alae.app öffnen sich
dann darin, und zuerst erscheint kurz ein Startbild mit dem App-Symbol. Dieses
Symbol speichert Android beim Installieren.

- **Name und Farben** übernimmt Chrome von selbst (bei einem neuen Namen
  fragt es vorher nach): Beim Öffnen der App prüft es höchstens einmal am Tag
  das Manifest, das Update folgt, sobald das Gerät lädt und im WLAN ist. Bei
  einer Bereichs-App klappt das, wenn sie über ihr Symbol oder einen Link auf
  denselben Bereich geöffnet wird. Die App setzt das Manifest eines schon
  besuchten Bereichs dafür gleich beim Start (siehe
  `frontend/src/lib/pwaManifest.ts`).
- **Ein ganz neues Symbol** übernimmt Chrome auf Android aus
  Sicherheitsgründen **nicht** automatisch. Wer nach dem Wechsel zum
  alae-Design noch das alte, violette Symbol sieht, entfernt die App vom
  Startbildschirm (Symbol lange drücken → „Deinstallieren“). Danach den Link in
  Chrome öffnen und über das Menü ⋮ → „Zum Startbildschirm hinzufügen“ bzw.
  „App installieren“ neu hinzufügen. Die Inhalte bleiben erhalten: Sie liegen
  auf dem Server, nicht in der App.

## Backups

Sichere den App-Datenordner (`.../share-app/data`). Er enthält Fotos, Videos und
die SQLite-DB. Tipp: QNAP **Hybrid Backup Sync**.

## Häufige Fehler

| Symptom | Ursache / Lösung |
|---|---|
| „Failed to fetch“ beim Öffnen/Upload | `VITE_API_BASE_URL` (Netlify) falsch, oder `PUBLIC_APP_URL` (Backend) passt nicht → CORS. Beide prüfen, Netlify neu deployen. |
| Upload bricht bei grossen Dateien ab | Normalerweise kein Problem (Chunks). Falls doch: `UPLOAD_CHUNK_SIZE_BYTES` ≤ 90 MB lassen (Cloudflare-Limit). Upload lässt sich fortsetzen (Datei erneut auswählen). |
| Videos spielen nicht ab | Im Container-Log steht „ffmpeg NICHT gefunden“. Offizielles Image nutzen (enthält ffmpeg) oder `VIDEO_PROCESSING=true` lassen. Download des Originals geht immer. |
| Datei zu gross | `UPLOAD_MAX_FILE_MB` erhöhen (Standard 10240 = 10 GB) und Backend neu starten. |
| „Zugang abgelaufen“ | Der Bereichs-Token ist abgelaufen (`ACCESS_TOKEN_TTL_DAYS`, Standard 60 Tage). Einfach Link erneut öffnen / Passwort erneut eingeben. |
| Neue Bereiche lassen sich nicht anlegen | Falscher `ADMIN_KEY`. Wert in `.env` prüfen. |
| Link öffnet die Startseite „Link oder Code einfügen“ | Alte App-Version auf dem Gerät mit einem `/d/`-Link (siehe „App-Updates auf den Geräten“). Link nochmals öffnen bzw. den Link im Format `/s/<bereich>` verschicken. |
| Beim Öffnen eines Links erscheint kurz das alte (violette) Symbol | Die App ist auf dem Gerät installiert und zeigt das Symbol von damals – ein neues Symbol übernimmt Android nicht von selbst. App vom Startbildschirm entfernen und neu hinzufügen (siehe „Installierte App“). |

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
