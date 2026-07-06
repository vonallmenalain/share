// Hilfsfunktionen, um aus einem Bild einen (gezoomten/rotierten) Ausschnitt als
// JPEG-Blob zu rendern. `croppedAreaPixels` stammt von react-easy-crop und ist
// in den Pixelkoordinaten des Bildes angegeben; die Rotation wird beim Zeichnen
// auf ein Canvas berücksichtigt.

export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (err) => reject(err));
    image.src = url;
  });
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Grösse der Bounding-Box eines um `rotation` Grad gedrehten Rechtecks. */
function rotatedSize(width: number, height: number, rotation: number) {
  const rad = toRad(rotation);
  return {
    width: Math.abs(Math.cos(rad) * width) + Math.abs(Math.sin(rad) * height),
    height: Math.abs(Math.sin(rad) * width) + Math.abs(Math.cos(rad) * height),
  };
}

/**
 * Rendert den gewählten Ausschnitt (mit Rotation) in ein Canvas und gibt einen
 * JPEG-Blob zurück. `maxSize` begrenzt die längste Kante des Ergebnisses, damit
 * das hochgeladene Vorschaubild nicht unnötig gross wird.
 */
export async function renderCroppedImage(
  imageSrc: string,
  pixelCrop: PixelCrop,
  rotation = 0,
  maxSize = 1200,
): Promise<Blob> {
  const image = await createImage(imageSrc);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas nicht verfügbar.');

  const { width: bBoxWidth, height: bBoxHeight } = rotatedSize(
    image.width,
    image.height,
    rotation,
  );

  canvas.width = bBoxWidth;
  canvas.height = bBoxHeight;

  ctx.translate(bBoxWidth / 2, bBoxHeight / 2);
  ctx.rotate(toRad(rotation));
  ctx.translate(-image.width / 2, -image.height / 2);
  ctx.drawImage(image, 0, 0);

  // Zielgrösse (ggf. herunterskaliert).
  let outW = Math.max(1, Math.round(pixelCrop.width));
  let outH = Math.max(1, Math.round(pixelCrop.height));
  const longest = Math.max(outW, outH);
  if (longest > maxSize) {
    const scale = maxSize / longest;
    outW = Math.max(1, Math.round(outW * scale));
    outH = Math.max(1, Math.round(outH * scale));
  }

  const out = document.createElement('canvas');
  const outCtx = out.getContext('2d');
  if (!outCtx) throw new Error('Canvas nicht verfügbar.');
  out.width = outW;
  out.height = outH;
  outCtx.imageSmoothingQuality = 'high';
  outCtx.drawImage(
    canvas,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outW,
    outH,
  );

  return new Promise<Blob>((resolve, reject) => {
    out.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Bild konnte nicht erzeugt werden.'))),
      'image/jpeg',
      0.85,
    );
  });
}
