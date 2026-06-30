# 2. Cloudflare Tunnel (API sicher ins Internet)

Damit das Netlify-Frontend mit deiner QNAP-API sprechen kann, muss die API über
HTTPS erreichbar sein – **ohne** Portfreigabe an deinem Router. Dafür ist ein
**Cloudflare Tunnel** ideal.

Ergebnis: Deine API ist unter **`https://api.alae.app`** erreichbar und leitet
intern an den Container `backend:4000` weiter.

> Empfehlung: Nutze für die API bewusst `api.alae.app` (gleiche Hauptdomain wie
> das Frontend `share.alae.app`). Dann sind Frontend und API „same-site“.

## 2.1 Voraussetzungen

- Die Domain **`alae.app`**, deren DNS bei **Cloudflare** verwaltet wird
  (kostenloser Plan genügt).

## 2.2 Tunnel anlegen (Dashboard, „Remotely-managed“)

1. Cloudflare-Dashboard → **Zero Trust** → **Networks → Tunnels**.
2. **Create a tunnel** → Typ **Cloudflared** → Name z.&nbsp;B. `share-app`.
3. Cloudflare zeigt dir einen **Token** (langer String nach `--token`). Kopiere ihn.

## 2.3 Tunnel-Container auf dem QNAP starten

Trage den Token in deine `.env` ein:

```ini
CLOUDFLARE_TUNNEL_TOKEN=eyJ....    # der Token aus Schritt 2.2
```

Starte den Tunnel (Profil `tunnel`):

```bash
cd /share/ZFS530_DATA/share/share-app
docker compose --profile tunnel up -d
docker compose logs -f cloudflared   # sollte "Registered tunnel connection" zeigen
```

Da `backend` und `cloudflared` im selben Compose-Netzwerk laufen, erreicht der
Tunnel das Backend unter `http://backend:4000`.

## 2.4 Public Hostname (Routing) konfigurieren

Zurück im Cloudflare-Dashboard beim Tunnel:

1. Reiter **Public Hostname** → **Add a public hostname**.
2. **Subdomain**: `api` · **Domain**: `alae.app` → ergibt `api.alae.app`.
3. **Service**: Type **HTTP**, URL **`backend:4000`**.
   - Läuft dein Tunnel ausnahmsweise nicht im selben Docker-Netz, stattdessen
     `http://<QNAP-IP>:4000`.
4. **Save**. Cloudflare legt den DNS-Eintrag automatisch an.

## 2.5 Wichtig: Upload-Limit erhöhen

Cloudflare begrenzt im **Free-Plan** den Body **pro HTTP-Anfrage auf ~100 MB**.
Diese App umgeht das, indem grosse Dateien in **5-MB-Chunks** hochgeladen werden
(jede Anfrage bleibt also klein) – Videos in beliebiger Grösse sind damit kein
Problem. Du musst hier normalerweise nichts ändern.

> Hinweis: Stelle die Chunk-Grösse (`UPLOAD_CHUNK_SIZE_BYTES`) nicht über ~90 MB,
> sonst kann eine einzelne Chunk-Anfrage das Cloudflare-Limit reissen.

## 2.6 Testen

```bash
curl https://api.alae.app/health
# {"ok":true,"time":"..."}
```

## 2.7 Diese URL brauchst du weiter

- In **Netlify** als `VITE_API_BASE_URL=https://api.alae.app` (siehe [3. Netlify](03-netlify.md)).
- Im **Backend** zeigt `PUBLIC_APP_URL=https://share.alae.app` (für CORS).

➡️ Weiter mit **[3. Netlify](03-netlify.md)**.
