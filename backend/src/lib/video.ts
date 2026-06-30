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
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
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
    return {
      width: v?.width ?? null,
      height: v?.height ?? null,
      duration: Number.isFinite(duration as number) ? (duration as number) : null,
      takenAt,
    };
  } catch {
    return { width: null, height: null, duration: null, takenAt: null };
  }
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
