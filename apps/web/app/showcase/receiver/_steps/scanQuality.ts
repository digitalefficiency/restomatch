/**
 * Client blur / darkness gate for an invoice photo (RCV-03, mobile-field-04):
 * under a second, before the upload, with a NAMED reason the receiver can act
 * on ("too dark — move to the light"). It never blocks: the receiver may use
 * the photo anyway, because a false alarm at the back door costs more than a
 * re-read.
 *
 * `assessScanQuality` is pure (grey pixels in, verdict out) and unit-tested;
 * `checkScanQuality` decodes a File in the browser and samples it down first.
 */

export type ScanQualityIssue = 'dark' | 'blurry';

/** Mean luma below this (0–255) is too dark to read. */
export const DARK_MEAN = 50;
/** Variance of the Laplacian below this on the sampled image reads as blurred. */
export const BLUR_VARIANCE = 60;
/** Images smaller than this (either side) can't be judged — never gated. */
export const MIN_JUDGED_SIDE = 320;
/** Long side of the sample the gate measures. */
export const SAMPLE_SIDE = 400;

export function assessScanQuality(gray: ArrayLike<number>, width: number, height: number): ScanQualityIssue | null {
  const n = width * height;
  if (n === 0) return null;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += gray[i]!;
  if (sum / n < DARK_MEAN) return 'dark';
  if (width < 3 || height < 3) return null;
  // 4-neighbour Laplacian; its variance is a standard focus measure.
  let lapSum = 0;
  let lapSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const lap = gray[i - width]! + gray[i + width]! + gray[i - 1]! + gray[i + 1]! - 4 * gray[i]!;
      lapSum += lap;
      lapSq += lap * lap;
      count += 1;
    }
  }
  const mean = lapSum / count;
  const variance = lapSq / count - mean * mean;
  return variance < BLUR_VARIANCE ? 'blurry' : null;
}

/** Browser: decode, sample down, grey-scale, assess. Any failure (PDF, old browser) → no verdict. */
export async function checkScanQuality(file: File): Promise<ScanQualityIssue | null> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') return null;
  try {
    const bmp = await createImageBitmap(file);
    if (bmp.width < MIN_JUDGED_SIDE || bmp.height < MIN_JUDGED_SIDE) {
      bmp.close();
      return null;
    }
    const scale = Math.min(1, SAMPLE_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
      gray[i] = (rgba[p]! * 299 + rgba[p + 1]! * 587 + rgba[p + 2]! * 114) / 1000;
    }
    return assessScanQuality(gray, w, h);
  } catch {
    return null;
  }
}
