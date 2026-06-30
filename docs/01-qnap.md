# 1. QNAP einrichten (Backend + Speicher)

Das Backend läuft als Docker-Container auf deinem QNAP. Dort liegen auch alle
**Fotos, Videos und die Metadaten-Datenbank** (eine einzelne `share.db`). Du
behältst die volle Kontrolle – nichts liegt bei einem Cloud-Anbieter.

## 1.1 Voraussetzungen

- QNAP mit **Container Station** (App Center → „Container Station“ installieren).
- Genug freier Speicher auf deiner Freigabe **„share“** (SSD-Volume).
- Empfohlen: **SSH-Zugang** (Systemsteuerung → Telnet/SSH → „SSH-Dienst aktivieren“).

## 1.2 Den Speicherordner vorbereiten

Du hast auf dem SSD-Volume bereits den Freigabeordner **`share`** erstellt. Lege
dort einen Unterordner für diese App an, z.&nbsp;B. `share-app`. Den vollständigen
Pfad findest du am QNAP heraus mit:

```bash
ls -d /share/*/share          # zeigt z. B. /share/ZFS530_DATA/share
```

Der Teil vor `/share` (z.&nbsp;B. `ZFS530_DATA` oder `CACHEDEV1_DATA`) hängt von
deinem Volume ab. **Merke dir den vollständigen Pfad** – du trägst ihn gleich in
die `docker-compose.yml` ein. Beispiel-Zielpfad für die App-Daten:

```
/share/ZFS530_DATA/share/share-app
```

Darin entstehen beim ersten Start automatisch:

```
data/share.db                 # SQLite-Datenbank (Metadaten)
data/storage/originals/       # Originaldateien (Download)
data/storage/thumbs/          # Galerie-Vorschaubilder
data/storage/previews/        # grosse Bildvorschauen (Lightbox)
data/storage/posters/         # Video-Standbilder
data/storage/video-previews/  # kleine, abspielbare Video-Vorschauen
data/storage/tmp/uploads/     # temporäre Chunks während eines Uploads
```

## 1.3 Projektdateien auf das QNAP bringen

Du brauchst auf dem QNAP nur **zwei Dateien**: `docker-compose.yml` und `.env`.
Den Quellcode musst du nicht kopieren – das fertige Backend-Image wird aus der
GitHub Container Registry (GHCR) gezogen.

```bash
mkdir -p /share/ZFS530_DATA/share/share-app
cd /share/ZFS530_DATA/share/share-app
# docker-compose.yml holen (Repo ist öffentlich):
curl -fsSL https://raw.githubusercontent.com/vonallmenalain/share/main/docker-compose.yml -o docker-compose.yml
```

> Alternativ per File Station hochladen.

## 1.4 Konfiguration (.env) anlegen

Im selben Ordner eine Datei `.env` erstellen (Vorlage: `backend/.env.example`):

```ini
PUBLIC_APP_URL=https://share.alae.app
JWT_SECRET=<openssl rand -base64 48>
ADMIN_KEY=<dein-geheimer-admin-schlüssel>
UPLOAD_MAX_FILE_MB=5120
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
COOKIE_DOMAIN=.alae.app
# Für den Cloudflare-Tunnel (Schritt 2) – erst später ausfüllen:
CLOUDFLARE_TUNNEL_TOKEN=
```

Secrets erzeugen (am Mac/Linux/QNAP-SSH):

```bash
openssl rand -base64 48      # für JWT_SECRET
```

- **`JWT_SECRET`** signiert die Zugriffs-Tokens. Geheim halten, nicht ändern
  (sonst werden bestehende Bereichs-Zugänge ungültig).
- **`ADMIN_KEY`** ist das Passwort, mit dem du im Frontend **neue Bereiche
  anlegst** (Seite `/new`) und die Übersicht (`/admin`) öffnest. Wähle etwas
  Starkes – wer ihn kennt, kann Bereiche erstellen und löschen.

## 1.5 Volume-Pfad in der docker-compose.yml anpassen

Öffne `docker-compose.yml` und setze den **linken** Teil des Volumes auf deinen
echten Pfad aus Schritt 1.2:

```yaml
    volumes:
      - /share/ZFS530_DATA/share/share-app/data:/data
```

(Der rechte Teil `/data` bleibt immer gleich – so erwartet es der Container.)

## 1.6 Container starten

### Variante A: SSH (am einfachsten)

```bash
cd /share/ZFS530_DATA/share/share-app
docker compose pull backend
docker compose up -d backend
docker compose logs -f backend
```

In den Logs solltest du sehen:

```
[server] listening on :4000 (env=production)
[server] data dir   : /data
[server] video      : ffmpeg OK
```

> `ffmpeg OK` heisst: Video-Poster und -Vorschauen werden erzeugt. Steht dort
> „ffmpeg NICHT gefunden“, läuft die App trotzdem – Videos sind dann nur als
> Download verfügbar. (Im offiziellen Image ist ffmpeg enthalten.)

### Variante B: Container Station GUI

1. Container Station → **Anwendung erstellen**.
2. Inhalt der `docker-compose.yml` einfügen, Volume-Pfad anpassen.
3. Die Umgebungsvariablen aus `.env` müssen verfügbar sein – am einfachsten ist
   die SSH-Variante. Alternativ die Werte direkt unter `environment:` eintragen.

## 1.7 Funktioniert es?

Im gleichen Netzwerk oder per SSH:

```bash
curl http://<QNAP-IP>:4000/health
# {"ok":true,"time":"..."}
```

## 1.8 Updates einspielen

**Manuell:**

```bash
cd /share/ZFS530_DATA/share/share-app
docker compose pull backend
docker compose up -d backend
```

**Automatisch (empfohlen):** Watchtower aktualisieren lassen –

```bash
docker compose --profile autoupdate up -d
```

Watchtower zieht künftig neue Images automatisch, sobald GitHub Actions sie
gebaut hat. Deine Daten im `data/`-Ordner bleiben dabei erhalten.

## 1.9 Backups

Sichere regelmässig den App-Datenordner (`.../share-app/data`) – er enthält
**alle Fotos, Videos und die Datenbank**. Am besten mit QNAP **Hybrid Backup
Sync** auf ein zweites Ziel.

---

## Checkliste

Was du **zusätzlich zum Code** selbst erstellen/erledigen musst:

- [ ] Unterordner `share-app` in der Freigabe **„share“** angelegt.
- [ ] `docker-compose.yml` + `.env` auf das QNAP gelegt, Volume-Pfad angepasst.
- [ ] `JWT_SECRET` und `ADMIN_KEY` in `.env` gesetzt.
- [ ] Backend-Container gestartet (`/health` antwortet).
- [ ] **[Cloudflare Tunnel](02-cloudflare-tunnel.md)** eingerichtet (`api.alae.app`).
- [ ] **[Netlify](03-netlify.md)** eingerichtet (`share.alae.app`, `VITE_API_BASE_URL`).

➡️ Weiter mit **[2. Cloudflare Tunnel](02-cloudflare-tunnel.md)**.
