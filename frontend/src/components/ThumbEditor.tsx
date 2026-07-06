import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Cropper, { Area, MediaSize } from 'react-easy-crop';
import { Item, api, fileUrl, uploadThumb } from '../api/client';
import { renderCroppedImage } from '../lib/crop';

interface Props {
  item: Item;
  token: string;
  uploaderName?: string;
  onClose: () => void;
  onSaved: (item: Item) => void;
}

type AspectValue = number | 'original';

const PRESETS: Array<{ key: string; label: string; value: AspectValue }> = [
  { key: 'original', label: 'Original', value: 'original' },
  { key: '1', label: '1:1', value: 1 },
  { key: '45', label: '4:5', value: 4 / 5 },
  { key: '34', label: '3:4', value: 3 / 4 },
  { key: '43', label: '4:3', value: 4 / 3 },
  { key: '169', label: '16:9', value: 16 / 9 },
  { key: '916', label: '9:16', value: 9 / 16 },
];

/**
 * Editor, um das Vorschaubild (Thumbnail) eines Fotos anzupassen: Ausschnitt
 * wählen, hinein-/herauszoomen und die Ansicht drehen. Das Ergebnis wird als
 * neues Thumbnail gespeichert und in der Galerie sowie den anderen Ansichten
 * angezeigt. Das Original bleibt unverändert.
 */
export default function ThumbEditor({ item, token, uploaderName, onClose, onSaved }: Props) {
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [presetKey, setPresetKey] = useState('original');
  const [naturalAspect, setNaturalAspect] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  // Vorschau als Blob laden (per fetch), damit das Canvas beim Rendern nicht
  // durch CORS „getaintet" wird (Object-URLs sind gleich-origin).
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    setLoadError(false);
    (async () => {
      try {
        const resp = await fetch(fileUrl(`/files/preview/${item.id}`, token));
        if (!resp.ok) throw new Error('load failed');
        const blob = await resp.blob();
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrcUrl(url);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.id, token]);

  const onMediaLoaded = useCallback((mediaSize: MediaSize) => {
    if (mediaSize.naturalHeight > 0) {
      setNaturalAspect(mediaSize.naturalWidth / mediaSize.naturalHeight);
    }
  }, []);

  const onCropComplete = useCallback((_a: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  // Effektives Seitenverhältnis des Ausschnitts – „Original" folgt dem Foto
  // (unter Berücksichtigung einer 90°-Drehung).
  const aspect = useMemo(() => {
    const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[0];
    if (preset.value === 'original') {
      return rotation % 180 === 0 ? naturalAspect : 1 / naturalAspect;
    }
    return preset.value;
  }, [presetKey, naturalAspect, rotation]);

  const rotate = (delta: number) => setRotation((r) => (((r + delta) % 360) + 360) % 360);

  const save = async () => {
    if (!srcUrl || !croppedAreaPixels) return;
    setBusy(true);
    try {
      const blob = await renderCroppedImage(srcUrl, croppedAreaPixels, rotation);
      const updated = await uploadThumb(item.id, blob, { token, uploaderName });
      onSaved(updated);
    } catch {
      setBusy(false);
      alert('Das Vorschaubild konnte nicht gespeichert werden. Bitte erneut versuchen.');
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      const res = await api<{ item: Item }>(`/api/items/${item.id}/thumb`, {
        method: 'DELETE',
        token,
        uploaderName,
      });
      onSaved(res.item);
    } catch {
      setBusy(false);
      alert('Das Vorschaubild konnte nicht zurückgesetzt werden.');
    }
  };

  // Zurück-Button (Android/Browser) schliesst den Editor, statt zu navigieren.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="thumb-editor" role="dialog" aria-label="Vorschaubild anpassen">
      <div className="te-top">
        <div className="te-title">Vorschaubild anpassen</div>
        <button className="lb-btn lb-icon" onClick={onClose} aria-label="Schliessen" disabled={busy}>
          ✕
        </button>
      </div>

      <div className="te-stage">
        {loadError ? (
          <div className="te-msg">Das Foto konnte nicht geladen werden.</div>
        ) : srcUrl ? (
          <Cropper
            image={srcUrl}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={aspect}
            minZoom={1}
            maxZoom={5}
            zoomSpeed={0.2}
            showGrid
            objectFit="contain"
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onRotationChange={setRotation}
            onCropComplete={onCropComplete}
            onMediaLoaded={onMediaLoaded}
          />
        ) : (
          <div className="te-msg">
            <span className="spinner lg white" />
          </div>
        )}
      </div>

      <div className="te-controls">
        <div className="te-row">
          <span className="te-label">Zoom</span>
          <input
            className="te-slider"
            type="range"
            min={1}
            max={5}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Zoom"
          />
          <button className="btn btn-sm" onClick={() => rotate(-90)} title="Nach links drehen">
            ⟲ 90°
          </button>
          <button className="btn btn-sm" onClick={() => rotate(90)} title="Nach rechts drehen">
            ⟳ 90°
          </button>
        </div>

        <div className="te-presets">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              className={`te-chip${presetKey === p.key ? ' active' : ''}`}
              onClick={() => setPresetKey(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="te-foot">
          <button className="btn btn-sm btn-ghost" onClick={reset} disabled={busy}>
            Standard wiederherstellen
          </button>
          <div className="spacer" />
          <button className="btn btn-sm" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button className="btn btn-sm btn-primary" onClick={save} disabled={busy || !srcUrl}>
            {busy ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}
