/**
 * Barcode detection behind one interface (W3-03a).
 *
 * The native `BarcodeDetector` (Chrome/Android, on-device, works offline) is the
 * first engine. The self-hosted ZXing WASM ponyfill joins `defaultBarcodeEngines()`
 * in W3-03b — after W2-15 final, as the wave's one package.json commit — with no
 * change to this API or to `ScanButton`. No engine at all → manual entry.
 */

/** A frame the engine can read: a playing <video>, a canvas, an ImageBitmap… */
export type BarcodeFrame = ImageBitmapSource;

export interface DetectedCode {
  rawValue: string;
  /** e.g. `ean_13`, `code_128`, `qr_code`. */
  format: string;
}

export interface BarcodeEngine {
  readonly id: string;
  /** Never throws; false when the engine (or every field format) is unavailable. */
  isSupported(): Promise<boolean>;
  detect(frame: BarcodeFrame): Promise<DetectedCode[]>;
}

/** The formats a delivery carries: retail EAN/UPC, logistics Code128/ITF/39, QR on newer labels. */
export const FIELD_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'] as const;

interface DetectorLike {
  detect(frame: BarcodeFrame): Promise<Array<{ rawValue: string; format: string }>>;
}
interface DetectorCtor {
  new (options?: { formats?: string[] }): DetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

/** Wraps `scope.BarcodeDetector`. `scope` is injectable for tests. */
export function nativeBarcodeEngine(scope: unknown = globalThis): BarcodeEngine {
  let formats: string[] | null = null;
  let detector: DetectorLike | null = null;
  const ctor = () => (scope as { BarcodeDetector?: DetectorCtor } | undefined)?.BarcodeDetector;

  async function supportedFormats(): Promise<string[]> {
    if (formats) return formats;
    const C = ctor();
    if (typeof C !== 'function') return (formats = []);
    let list: string[] = [...FIELD_FORMATS];
    if (typeof C.getSupportedFormats === 'function') {
      try {
        const native = await C.getSupportedFormats();
        list = FIELD_FORMATS.filter((f) => native.includes(f));
      } catch {
        list = [];
      }
    }
    return (formats = list);
  }

  return {
    id: 'native',
    async isSupported() {
      return (await supportedFormats()).length > 0;
    },
    async detect(frame) {
      if (!detector) {
        const C = ctor();
        if (typeof C !== 'function') return [];
        detector = new C({ formats: await supportedFormats() });
      }
      const found = await detector.detect(frame);
      return found.map((c) => ({ rawValue: c.rawValue, format: c.format }));
    },
  };
}

/** The engines tried in order. W3-03b appends the ZXing ponyfill here. */
export function defaultBarcodeEngines(scope: unknown = globalThis): BarcodeEngine[] {
  return [nativeBarcodeEngine(scope)];
}

/** The first supported engine, or null (→ manual entry). Never throws. */
export async function resolveBarcodeEngine(engines: readonly BarcodeEngine[]): Promise<BarcodeEngine | null> {
  for (const engine of engines) {
    try {
      if (await engine.isSupported()) return engine;
    } catch {
      /* next engine */
    }
  }
  return null;
}

const MAX_CODE = 64;

/** Trim, drop whitespace and control characters, cap the length. '' = nothing usable. */
export function normalizeCode(raw: string): string {
  const clean = raw.replace(/[\s\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, '');
  return clean.slice(0, MAX_CODE);
}

/**
 * Polls `grab()` every `intervalMs` until a usable code is read or `signal`
 * aborts (→ null). A frame that throws or is not ready yet is skipped.
 */
export async function scanFrames(
  engine: BarcodeEngine,
  grab: () => BarcodeFrame | null,
  { signal, intervalMs = 120 }: { signal: AbortSignal; intervalMs?: number },
): Promise<DetectedCode | null> {
  while (!signal.aborted) {
    const frame = grab();
    if (frame) {
      try {
        const hit = (await engine.detect(frame)).find((c) => normalizeCode(c.rawValue) !== '');
        if (hit && !signal.aborted) return { rawValue: normalizeCode(hit.rawValue), format: hit.format };
      } catch {
        /* a bad frame: keep scanning */
      }
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, intervalMs);
      signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
    });
  }
  return null;
}

export type CameraFailure = 'denied' | 'failed';

/** Permission refusals read as "denied"; everything else (no camera, busy, constraints) as "failed". */
export function classifyCameraError(error: unknown): CameraFailure {
  const name = (error as { name?: string } | null)?.name;
  return name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError' ? 'denied' : 'failed';
}

/** The rear camera, no audio. */
export function openRearCamera(media: Pick<MediaDevices, 'getUserMedia'>): Promise<MediaStream> {
  return media.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
}
