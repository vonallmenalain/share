# 2. Cloudflare Tunnel (API sicher ins Internet)

Damit das Netlify-Frontend mit deiner QNAP-API sprechen kann, muss die API über
HTTPS erreichbar sein – **ohne** Portfreigabe an deinem Router. Dafür ist ein
**Cloudflare Tunnel** ideal.

Ergebnis: Deine API ist unter **`https://api.alae.app`** erreichbar und leitet
intern an den Container `backend:4000` weiter.

> Empfehlung: Nutze für die API bewusst `api.alae.app` (gleiche Hauptdomain wie
> das Frontend `share.alae.app`). Dann sind Frontend und API „same-site“. Ist
> `api.alae.app` bei dir schon durch ein anderes Projekt/Tunnel belegt, nimm
> stattdessen z.&nbsp;B. `share-api.alae.app` – siehe Hinweis in [2.4](#24-public-hostname-routing-konfigurieren).

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

> ⚠️ **Hostname schon vergeben?** Ein Hostname (z. B. `api.alae.app`) kann immer
> nur auf **einen** Tunnel zeigen – Cloudflare legt dafür automatisch einen
> DNS-Eintrag an, der auf die Tunnel-ID zeigt. Hast du `alae.app` schon für ein
> anderes Projekt mit einem eigenen Tunnel genutzt und dort bereits `api.alae.app`
> als Public Hostname angelegt, **darfst du diesen Hostnamen hier nicht erneut
> verwenden** – Cloudflare würde sonst entweder einen Fehler melden oder den
> bestehenden DNS-Eintrag überschreiben und damit das andere Projekt
> unerreichbar machen. Wähle in diesem Fall eine andere, garantiert freie
> Subdomain, z. B. **`share-api.alae.app`**, und verwende sie konsequent überall,
> wo in dieser Anleitung `api.alae.app` als Beispiel steht (insbesondere bei
> `VITE_API_BASE_URL` in [3. Netlify](03-netlify.md)).

Zurück im Cloudflare-Dashboard beim Tunnel:

1. Reiter **Public Hostname** → **Add a public hostname**.
2. **Subdomain**: `api` (oder deine alternative Subdomain, siehe oben) ·
   **Domain**: `alae.app` → ergibt z.&nbsp;B. `api.alae.app`.
3. **Path**: leer lassen (matcht alle Pfade).
4. **Service URL**: `http://backend:4000` (im neueren Dashboard ist das ein
   einzelnes Feld inkl. Protokoll, in älteren Versionen separate Felder
   **Type** `HTTP` und **URL** `backend:4000`). Bewusst **`http://`**, nicht
   `https://` – die Verbindung zwischen `cloudflared` und `backend` läuft
   unverschlüsselt im selben Docker-Netzwerk, Cloudflare übernimmt TLS nach
   aussen.
   - Läuft dein Tunnel ausnahmsweise nicht im selben Docker-Netz, stattdessen
     `http://<QNAP-IP>:4000`.
5. **Add route** / **Save**. Cloudflare legt den DNS-Eintrag automatisch an.

## 2.5 Wichtig: Upload-Limit erhöhen

Cloudflare begrenzt im **Free-Plan** den Body **pro HTTP-Anfrage auf ~100 MB**.
Diese App umgeht das, indem grosse Dateien in **5-MB-Chunks** hochgeladen werden
(jede Anfrage bleibt also klein) – Videos in beliebiger Grösse sind damit kein
Problem. Du musst hier normalerweise nichts ändern.

> Hinweis: Stelle die Chunk-Grösse (`UPLOAD_CHUNK_SIZE_BYTES`) nicht über ~90 MB,
> sonst kann eine einzelne Chunk-Anfrage das Cloudflare-Limit reissen.

## 2.6 Standort-Header für die Zugriffsstatistik (optional, empfohlen)

Der **Adminbereich** kann pro Bereich alle Zugriffe protokollieren – inkl. Datum,
Person, IP und **Standort** (Stadt/Region/Land). Diese Statistik ist **nur für den
Admin** sichtbar und braucht **keine** externe Datenbank: alles landet in derselben
lokalen SQLite-Datei auf dem QNAP.

Den Standort kann das Backend aus der IP allein nicht bestimmen. Cloudflare liefert
die Geodaten aber **kostenlos** als HTTP-Header mit – dazu einmalig einschalten:

1. Cloudflare-Dashboard → deine Domain **`alae.app`** wählen.
2. **Rules → Transform Rules → Managed Transforms**.
3. **„Add visitor location headers"** aktivieren (fügt u. a. `cf-ipcity`,
   `cf-ipcountry`, `cf-iplatitude`, `cf-iplongitude`, `cf-region` hinzu).

Ohne diese Header funktioniert die Statistik trotzdem – es werden dann nur IP und
(sofern vorhanden) das Land aus `cf-ipcountry` gespeichert, ohne Stadt/Koordinaten.

## 2.7 Testen

Ersetze `api.alae.app` durch deinen tatsächlich gewählten Hostnamen (siehe
Hinweis in 2.4), falls abweichend:

```bash
curl https://api.alae.app/health
# {"ok":true,"time":"..."}
```

## 2.8 Diese URL brauchst du weiter

- In **Netlify** als `VITE_API_BASE_URL=https://api.alae.app` – bzw. dein
  tatsächlich gewählter Hostname (siehe [3. Netlify](03-netlify.md)).
- Im **Backend** zeigt `PUBLIC_APP_URL=https://share.alae.app` (für CORS).

➡️ Weiter mit **[3. Netlify](03-netlify.md)**.
