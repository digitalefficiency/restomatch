'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Keyboard, ScanBarcode } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { common } from '@/lib/i18n/messages/common';
import { Button } from '../Button';
import { Field, Input } from '../Input';
import { cnMerge as cn } from '../cn';
import {
  classifyCameraError,
  defaultBarcodeEngines,
  normalizeCode,
  openRearCamera,
  resolveBarcodeEngine,
  scanFrames,
  type BarcodeEngine,
} from './barcode';

export type ScanSource = 'camera' | 'manual';
export type ScanNotice = 'unsupported' | 'denied' | 'failed';
export interface ScanMeta {
  source: ScanSource;
  /** The symbology for a camera read (`ean_13`…); `manual` for typed entry. */
  format: string;
}

export interface ScanButtonProps {
  /** One usable, normalised code per scan or typed entry. */
  onCode: (code: string, meta: ScanMeta) => void;
  /** Engines tried in order; defaults to native BarcodeDetector (ZXing joins in W3-03b). */
  engines?: readonly BarcodeEngine[];
  /** Overrides the visible label (default "סריקת ברקוד"). */
  label?: string;
  disabled?: boolean;
  className?: string;
  /** Initial panel — tests and the showcase only. */
  initialMode?: 'idle' | 'manual';
  initialNotice?: ScanNotice | null;
}

type Mode = 'idle' | 'scanning' | 'manual';

/**
 * Field barcode scanner (W3-03a). A 56 px thumb button; the camera panel and
 * the manual-entry fallback open inline below it (no portal, works offline:
 * the native detector runs on-device). Shows no ₪.
 */
export function ScanButton({
  onCode,
  engines,
  label,
  disabled,
  className,
  initialMode = 'idle',
  initialNotice = null,
}: ScanButtonProps) {
  const t = useT(common);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [notice, setNotice] = useState<ScanNotice | null>(initialNotice);
  const [last, setLast] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const panelId = useId();
  const list = useMemo(() => engines ?? defaultBarcodeEngines(), [engines]);

  const release = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };
  useEffect(() => release, []);

  const emit = (raw: string, meta: ScanMeta) => {
    const code = normalizeCode(raw);
    if (!code) return false;
    setLast(code);
    onCode(code, meta);
    return true;
  };

  const toManual = (why: ScanNotice | null) => {
    release();
    setNotice(why);
    setMode('manual');
  };

  async function start() {
    release();
    const ac = new AbortController();
    abortRef.current = ac;
    const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    const engine = await resolveBarcodeEngine(list);
    if (ac.signal.aborted) return;
    if (!engine || typeof media?.getUserMedia !== 'function') return toManual('unsupported');
    setNotice(null);
    setMode('scanning');
    try {
      const stream = await openRearCamera(media);
      if (ac.signal.aborted) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      const hit = await scanFrames(engine, () => (video && video.readyState >= 2 ? video : null), { signal: ac.signal });
      if (!hit) return;
      release();
      setMode('idle');
      emit(hit.rawValue, { source: 'camera', format: hit.format });
    } catch (error) {
      if (!ac.signal.aborted) toManual(classifyCameraError(error));
    }
  }

  const cancel = () => {
    release();
    setMode('idle');
    setNotice(null);
    setTypedError(false);
  };

  const submitTyped = (event: React.FormEvent) => {
    event.preventDefault();
    if (!emit(typed, { source: 'manual', format: 'manual' })) return setTypedError(true);
    setTyped('');
    setTypedError(false);
    setMode('idle');
    setNotice(null);
  };

  return (
    <div className={cn('flex flex-col gap-3', className)} data-field="scan">
      <Button
        type="button"
        variant="secondary"
        size="xl"
        fullWidth
        disabled={disabled}
        pressed={mode !== 'idle'}
        aria-controls={panelId}
        aria-expanded={mode !== 'idle'}
        icon={<ScanBarcode className="h-6 w-6" aria-hidden="true" />}
        className="border-2 border-line-strong"
        onClick={() => (mode === 'idle' ? void start() : cancel())}
      >
        {label ?? t('field.scan.button')}
      </Button>

      <p role="status" aria-live="polite" className="text-body-sm text-ink empty:hidden">
        {notice ? t(`field.scan.${notice}`) : last && mode === 'idle' ? t('field.scan.found', { code: last }) : ''}
      </p>

      <div id={panelId} hidden={mode === 'idle'} className="flex flex-col gap-3">
        {mode === 'scanning' && (
          <>
            <div className="relative overflow-hidden rounded-card border-2 border-line-strong bg-surface-2">
              <video ref={videoRef} className="aspect-[4/3] w-full object-cover" playsInline muted autoPlay aria-hidden="true" />
              <div className="pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 bg-primary-bold" aria-hidden="true" />
            </div>
            <p className="text-body text-ink">{t('field.scan.scanning')}</p>
            <div className="grid grid-cols-2 gap-3">
              <Button type="button" variant="secondary" size="xl" onClick={() => toManual(null)} icon={<Keyboard className="h-5 w-5" aria-hidden="true" />}>
                {t('field.scan.typeInstead')}
              </Button>
              <Button type="button" variant="ghost" size="xl" onClick={cancel}>
                {t('field.scan.cancel')}
              </Button>
            </div>
          </>
        )}
        {mode === 'manual' && (
          <form onSubmit={submitTyped} className="flex flex-col gap-3" noValidate>
            <Field label={t('field.scan.manualLabel')} hint={t('field.scan.manualHint')} error={typedError ? t('field.scan.empty') : undefined}>
              <Input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                inputMode="numeric"
                autoComplete="off"
                enterKeyHint="done"
                autoFocus
                className="min-h-14 text-body"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Button type="submit" variant="primary" size="xl">
                {t('field.scan.submit')}
              </Button>
              <Button type="button" variant="ghost" size="xl" onClick={cancel}>
                {t('field.scan.cancel')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
