# 3. Netlify (Frontend hosten)

Das Frontend (React/Vite) wird als statische Seite auf Netlify deployed und ist
unter **`share.alae.app`** erreichbar.

## 3.1 Repository verbinden

1. Bei [netlify.com](https://www.netlify.com/) anmelden.
2. **Add new site → Import an existing project** → Git-Anbieter wählen → dieses
   Repository (`share`) auswählen.

## 3.2 Build-Einstellungen

Die Dateien `netlify.toml` (Repo-Root) und `frontend/netlify.toml` sind bereits
vorbereitet und sollten beim Import automatisch erkannt werden:

- **Base directory**: `frontend`
- **Build command**: `npm run build`
- **Publish directory**: `frontend/dist` (relativ: `dist`)

> Warum zwei `netlify.toml`-Dateien? Netlify sucht beim allerersten Deploy nur
> im **Repo-Root** nach Konfiguration – bevor das Base directory überhaupt
> bekannt ist. Die Root-Datei setzt deshalb nur `base = "frontend"`; Netlify
> lädt dann automatisch zusätzlich `frontend/netlify.toml` mit Build-Command,
> Publish-Directory, Redirects und Headers nach. Ohne die Root-Datei kann es
> passieren, dass Netlify vom Repo-Root aus baut (dort gibt es kein
> `package.json`), nichts Sinnvolles veröffentlicht und die Domain dauerhaft
> die generische Netlify-Seite **„Page not found“** zeigt – siehe 3.6.

Falls Netlify die Werte trotzdem nicht automatisch übernimmt, trage sie manuell
so ein.

### Build-Einstellungen nachträglich ändern (Site existiert schon)

Wurde die Site bereits angelegt (z. B. über **Import an existing project**) und du
willst Base directory/Build command/Publish directory nachträglich prüfen oder
korrigieren:

1. Im Netlify-Dashboard die Site öffnen.
2. Im linken Menü **Project configuration → Build & deploy → Continuous
   deployment** wählen.
3. Im Abschnitt **Build settings** auf **Edit settings** (bzw. **Configure**,
   falls noch nichts gesetzt ist) klicken.
4. Die Werte wie oben eintragen (**Base directory**: `frontend`, **Build
   command**: `npm run build`, **Publish directory**: `dist`) und speichern.
5. Danach unter **Deploys → Trigger deploy → Clear cache and deploy site**
   einen neuen Build anstoßen, damit die geänderten Einstellungen wirksam
   werden.

> Eine im Repo liegende `netlify.toml` (wie `frontend/netlify.toml`) überschreibt
> diese UI-Einstellungen bei jedem Deploy wieder. Die manuelle Eingabe ist also
> nur als Fallback nötig, falls Netlify die Datei beim Verbinden nicht
> automatisch erkennt.

## 3.3 Umgebungsvariable setzen (sehr wichtig)

**Project configuration → Environment variables → Add a variable:**
(in älteren Netlify-Oberflächen: **Site configuration → Environment variables**)

| Key | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://api.alae.app` (deine Cloudflare-Tunnel-URL) |

> Diese Variable wird **beim Build** eingebacken. Wenn du sie änderst, musst du
> **neu deployen** (Deploys → Trigger deploy → Clear cache and deploy site).

## 3.4 Eigene Domain (share.alae.app)

1. **Project configuration → Domain management → Add a domain** → `share.alae.app`.
   (in älteren Netlify-Oberflächen: **Site configuration → Domain management**)
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

Zeigt `share.alae.app` stattdessen die generische Netlify-Seite **„Page not
found“** (nicht die App selbst), wurde noch kein gültiger Deploy
veröffentlicht. Prüfe in dieser Reihenfolge:

1. **Deploys → letzter Deploy**: Ist er **„Published“** (grün) oder
   fehlgeschlagen/„Skipped“? Bei Fehlern im **Deploy log** nachsehen
   (häufig: kein `package.json` gefunden → Base directory fehlt/falsch).
2. **Project configuration → Build & deploy → Build settings**: Stehen dort
   wirklich **Base directory** `frontend`, **Build command** `npm run build`,
   **Publish directory** `dist`? Falls nicht, manuell eintragen (siehe oben)
   und unter **Deploys → Trigger deploy → Clear cache and deploy site** neu
   bauen.
3. **Project configuration → Domain management**: Ist `share.alae.app`
   wirklich **dieser** Site zugeordnet (und nicht versehentlich einer anderen/
   leeren Site)? Im DNS sollte der **CNAME** `share` auf die `*.netlify.app`-
   Adresse genau dieser Site zeigen.
4. Erst wenn unter **Deploys** ein grüner „Published“-Deploy mit Inhalt aus
   `frontend/dist` steht, liefert die Domain die App statt der 404-Seite.

➡️ Weiter mit **[4. Betrieb &amp; Troubleshooting](04-betrieb.md)**.
