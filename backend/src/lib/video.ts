import { spawn } from 'child_process';
import fsp from 'fs/promises';
import path from 'path';
import { config } from '../config';
import { variantPath } from './media';

export interface VideoResult {
  width: number | null;
  height: number | null;
  duration: number | null;
  takenAt: string | null;
  posterCreated: boolean;
  previewCreated: boolean;
}

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** Prüft beim Start, ob ffmpeg/ffprobe verfügbar sind. */
export async function checkFfmpeg(): Promise<boolean> {
  if (!config.video.enabled) return false;
  try {
    const r = await run(config.video.ffmpegPath, ['-version']);
    return r.code === 0;
  } catch {
    return false;
  }
}

async function probe(input: string): Promise<{
  width: number | null;
  height: number | null;
  duration: number | null;
  takenAt: string | null;
}> {
  try {
    const r = await run(config.video.ffprobePath, [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      input,
    ]);
    if (r.code !== 0) return { width: null, height: null, duration: null, takenAt: null };
    const data = JSON.parse(r.stdout) as {
      streams?: Array<{
        codec_type?: string;
        width?: number;
        height?: number;
        tags?: Record<string, string>;
        side_data_list?: Array<{ rotation?: number }>;
      }>;
      format?: { duration?: string; tags?: Record<string, string> };
    };
    const v = data.streams?.find((s) => s.codec_type === 'video');
    const duration = data.format?.duration ? parseFloat(data.format.duration) : null;
    const creation = data.format?.tags?.creation_time ?? null;
    let takenAt: string | null = null;
    if (creation) {
      const d = new Date(creation);
      if (!Number.isNaN(d.getTime())) takenAt = d.toISOString();
    }

    // Rotation berücksichtigen: Smartphones speichern Hochformat-Videos häufig
    // als Querformat-Stream mit einem Rotations-Flag (rotate-Tag oder Display-
    // Matrix in side_data_list). ffmpeg richtet Poster/Vorschau automatisch
    // korrekt aus – wir müssen daher auch die gemeldeten Masse drehen, damit die
    // Galerie das richtige Seitenverhältnis (Hochformat) anzeigt.
    let width = v?.width ?? null;
    let height = v?.height ?? null;
    const rotation = videoRotation(v);
    if ((rotation === 90 || rotation === 270) && width != null && height != null) {
      [width, height] = [height, width];
    }

    return {
      width,
      height,
      duration: Number.isFinite(duration as number) ? (duration as number) : null,
      takenAt,
    };
  } catch {
    return { width: null, height: null, duration: null, takenAt: null };
  }
}

/** Ermittelt die effektive Rotation (0/90/180/270) eines Video-Streams. */
function videoRotation(stream?: {
  tags?: Record<string, string>;
  side_data_list?: Array<{ rotation?: number }>;
}): number {
  if (!stream) return 0;
  let deg = 0;
  const tag = stream.tags?.rotate;
  if (tag != null && tag !== '') {
    const n = parseInt(tag, 10);
    if (Number.isFinite(n)) deg = n;
  }
  const side = stream.side_data_list?.find((s) => typeof s.rotation === 'number');
  if (side && typeof side.rotation === 'number') {
    // Die Display-Matrix meldet die Rotation üblicherweise negativ.
    deg = -side.rotation;
  }
  deg = ((deg % 360) + 360) % 360;
  return deg;
}

/**
 * Erzeugt aus dem Original-Video ein Poster (Standbild) und eine kleinere,
 * gut streambare Vorschau (H.264/AAC, faststart). Das Original bleibt
 * unverändert. Schlägt die Verarbeitung fehl (z. B. ffmpeg fehlt), wird das
 * Item trotzdem gespeichert – nur ohne Poster/Vorschau.
 */
export async function processVideo(originalPath: string, storageKey: string): Promise<VideoResult> {
  const meta = await probe(originalPath);
  const result: VideoResult = {
    width: meta.width,
    height: meta.height,
    duration: meta.duration,
    takenAt: meta.takenAt,
    posterCreated: false,
    previewCreated: false,
  };

  if (!config.video.enabled) return result;

  // Poster: Frame ~1s (oder am Anfang bei sehr kurzen Clips).
  const posterDest = variantPath('poster', storageKey);
  await fsp.mkdir(path.dirname(posterDest), { recursive: true });
  const seek = meta.duration && meta.duration > 1.5 ? '1' : '0';
  try {
    const r = await run(config.video.ffmpegPath, [
      '-y',
      '-ss',
      seek,
      '-i',
      originalPath,
      '-frames:v',
      '1',
      '-vf',
      `scale='min(${config.images.previewMax},iw)':-2`,
      '-q:v',
      '3',
      posterDest,
    ]);
    result.posterCreated = r.code === 0;
  } catch {
    /* ignore */
  }

  // Vorschau-Video: auf max. Höhe skaliert, H.264 + AAC, faststart.
  const previewDest = variantPath('video-preview', storageKey);
  await fsp.mkdir(path.dirname(previewDest), { recursive: true });
  try {
    const r = await run(config.video.ffmpegPath, [
      '-y',
      '-i',
      originalPath,
      '-vf',
      `scale=-2:'min(${config.video.previewMaxHeight},ih)'`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      String(config.video.previewCrf),
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      previewDest,
    ]);
    result.previewCreated = r.code === 0;
  } catch {
    /* ignore */
  }

  return result;
}
