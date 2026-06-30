import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { config, paths } from './config';
import { initDb, getDb, UploadRow } from './db';
import { errorHandler, notFound } from './middleware/errors';
import { checkFfmpeg } from './lib/video';
import spacesRoutes from './routes/spaces';
import itemsRoutes from './routes/items';
import uploadsRoutes from './routes/uploads';
import filesRoutes from './routes/files';

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const allowed = new Set<string>([config.publicAppUrl, ...config.extraCorsOrigins]);
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true); // same-origin / curl / native app
        if (allowed.has(origin)) return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
      },
      credentials: true,
    }),
  );

  app.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // JSON-Parser NUR für JSON-Routen; die Chunk-Uploads nutzen einen eigenen
  // raw-Parser (siehe routes/uploads.ts) und dürfen davon nicht erfasst werden.
  app.use('/api/spaces', express.json({ limit: '1mb' }), spacesRoutes);
  app.use('/api/items', express.json({ limit: '1mb' }), itemsRoutes);
  app.use('/api/uploads', express.json({ limit: '1mb' }), uploadsRoutes);
  app.use('/files', filesRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

/** Räumt abgelaufene, unvollständige Upload-Sessions samt Chunks auf. */
async function cleanupStaleUploads() {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - config.upload.sessionTtlHours * 3600 * 1000).toISOString();
    const stale = db
      .prepare(`SELECT * FROM uploads WHERE status = 'open' AND updated_at < ?`)
      .all(cutoff) as UploadRow[];
    for (const u of stale) {
      db.prepare('DELETE FROM uploads WHERE id = ?').run(u.id);
      await fsp
        .rm(path.join(paths.tmpUploads(), u.id), { recursive: true, force: true })
        .catch(() => undefined);
    }
    if (stale.length) {
      // eslint-disable-next-line no-console
      console.log(`[cleanup] removed ${stale.length} stale upload session(s)`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[cleanup] failed', err);
  }
}

async function main() {
  // Speicherverzeichnisse auf dem (QNAP-)Volume sicherstellen.
  for (const dir of [
    config.dataDir,
    paths.storage(),
    paths.originals(),
    paths.thumbs(),
    paths.previews(),
    paths.posters(),
    paths.videoPreviews(),
    paths.tmpUploads(),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  initDb();

  await cleanupStaleUploads();
  setInterval(() => void cleanupStaleUploads(), 6 * 60 * 60 * 1000).unref();

  const ffmpegOk = await checkFfmpeg();

  const app = buildApp();
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] listening on :${config.port} (env=${config.env})`);
    console.log(`[server] data dir   : ${config.dataDir}`);
    console.log(`[server] public app : ${config.publicAppUrl}`);
    console.log(
      `[server] video      : ${
        config.video.enabled ? (ffmpegOk ? 'ffmpeg OK' : 'ffmpeg NICHT gefunden – Videos ohne Vorschau/Poster') : 'deaktiviert'
      }`,
    );
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[server] failed to start', err);
  process.exit(1);
});
