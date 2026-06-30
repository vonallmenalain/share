# 3. Netlify (Frontend hosten)

Das Frontend (React/Vite) wird als statische Seite auf Netlify deployed und ist
unter **`share.alae.app`** erreichbar.

## 3.1 Repository verbinden

1. Bei [netlify.com](https://www.netlify.com/) anmelden.
2. **Add new site → Import an existing project** → Git-Anbieter wählen → dieses
   Repository (`share`) auswählen.

## 3.2 Build-Einstellungen

Die Datei `frontend/netlify.toml` ist bereits vorbereitet. Wichtig ist nur, dass
das **Base directory** auf `frontend` zeigt. Netlify liest dann automatisch:

- **Base directory**: `frontend`
- **Build command**: `npm run build`
- **Publish directory**: `frontend/dist` (relativ: `dist`)

Falls Netlify die Werte nicht automatisch übernimmt, trage sie manuell so ein.

## 3.3 Umgebungsvariable setzen (sehr wichtig)

**Site configuration → Environment variables → Add a variable:**

| Key | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://api.alae.app` (deine Cloudflare-Tunnel-URL) |

> Diese Variable wird **beim Build** eingebacken. Wenn du sie änderst, musst du
> **neu deployen** (Deploys → Trigger deploy → Clear cache and deploy site).

## 3.4 Eigene Domain (share.alae.app)

1. **Site configuration → Domain management → Add a domain** → `share.alae.app`.
2. Im DNS deiner Domain `alae.app` einen **CNAME** `share` auf die
   `*.netlify.app`-Adresse deiner Site setzen (oder Netlify-DNS verwenden).
3. Netlify stellt automatisch ein **HTTPS-Zertifikat** aus (Let’s Encrypt).
4. Optional: `share.alae.app` als **Primary domain** festlegen.

## 3.5 Backend auf diese Domain einstellen

Im **Backend** (`.env` auf dem QNAP) muss die App-Domain für CORS stimmen:

```ini
PUBLIC_APP_URL=https://share.alae.app
# Optional zusätzlich die rohe Netlify-URL erlauben:
# EXTRA_CORS_ORIGINS=https://<deine-site>.netlify.app
```

Backend neu starten:

```bash
docker compose up -d backend
```

## 3.6 Test

1. `https://share.alae.app` öffnen → Startseite.
2. `https://share.alae.app/new` → Bereich erstellen (Admin-Schlüssel = `ADMIN_KEY`).
3. Link öffnen, Namen eingeben, ein Foto hochladen → erscheint in der Galerie.

Zeigt der Upload/Login „Failed to fetch“: meist falsche `VITE_API_BASE_URL`,
fehlendes HTTPS, oder `PUBLIC_APP_URL` im Backend passt nicht zu
`share.alae.app` (CORS). Siehe **[4. Betrieb](04-betrieb.md)**.

➡️ Weiter mit **[4. Betrieb &amp; Troubleshooting](04-betrieb.md)**.
