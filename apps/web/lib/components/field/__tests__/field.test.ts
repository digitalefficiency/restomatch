import '../../__tests__/reactGlobal';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n/client';
import type { AppLocale } from '../../../i18n/config';
import { common as arCommon } from '../../../i18n/messages/receiverLangs/overlays/ar/common';
import { he } from '../../../i18n/messages/common/he';
import { en } from '../../../i18n/messages/common/en';
import {
  FIELD_FORMATS,
  classifyCameraError,
  defaultBarcodeEngines,
  nativeBarcodeEngine,
  normalizeCode,
  resolveBarcodeEngine,
  scanFrames,
  type BarcodeEngine,
} from '../barcode';
import { classifySpeechError, speechRecognitionCtor, startDictation, type RecognitionLike } from '../speech';
import { MicButton } from '../MicButton';
import { ScanButton } from '../ScanButton';

/** A mocked `BarcodeDetector` (no browser in vitest). */
function mockDetector(opts: { formats?: string[] | 'throws'; reads?: Array<Array<{ rawValue: string; format: string }>> } = {}) {
  const reads = [...(opts.reads ?? [])];
  const constructed: Array<{ formats?: string[] }> = [];
  class BarcodeDetector {
    constructor(o?: { formats?: string[] }) {
      constructed.push(o ?? {});
    }
    static async getSupportedFormats() {
      if (opts.formats === 'throws') throw new Error('nope');
      return opts.formats ?? ['ean_13', 'code_128', 'aztec'];
    }
    async detect() {
      return reads.shift() ?? [];
    }
  }
  return { scope: { BarcodeDetector }, constructed };
}

const frame = {} as ImageBitmapSource;

describe('nativeBarcodeEngine (mocked BarcodeDetector)', () => {
  it('is unsupported without BarcodeDetector', async () => {
    expect(await nativeBarcodeEngine({}).isSupported()).toBe(false);
    expect(await nativeBarcodeEngine(undefined).isSupported()).toBe(false);
    expect(await nativeBarcodeEngine({}).detect(frame)).toEqual([]);
  });
  it('asks only for the field formats the device supports', async () => {
    const { scope, constructed } = mockDetector({ reads: [[{ rawValue: '7290000000017', format: 'ean_13' }]] });
    const engine = nativeBarcodeEngine(scope);
    expect(await engine.isSupported()).toBe(true);
    expect(await engine.detect(frame)).toEqual([{ rawValue: '7290000000017', format: 'ean_13' }]);
    expect(constructed).toEqual([{ formats: ['ean_13', 'code_128'] }]);
  });
  it('is unsupported when no field format is supported or the probe throws', async () => {
    expect(await nativeBarcodeEngine(mockDetector({ formats: ['aztec'] }).scope).isSupported()).toBe(false);
    expect(await nativeBarcodeEngine(mockDetector({ formats: 'throws' }).scope).isSupported()).toBe(false);
  });
  it('the default list starts with the native engine', () => {
    expect(defaultBarcodeEngines({}).map((e) => e.id)).toEqual(['native']);
    expect(FIELD_FORMATS).toContain('ean_13');
  });
});

describe('resolveBarcodeEngine', () => {
  const engine = (id: string, ok: boolean | 'throws'): BarcodeEngine => ({
    id,
    isSupported: async () => {
      if (ok === 'throws') throw new Error('x');
      return ok;
    },
    detect: async () => [],
  });
  it('picks the first supported engine and skips throwing ones', async () => {
    expect((await resolveBarcodeEngine([engine('a', 'throws'), engine('b', false), engine('c', true)]))?.id).toBe('c');
  });
  it('null when none is supported (→ manual entry)', async () => {
    expect(await resolveBarcodeEngine([])).toBeNull();
    expect(await resolveBarcodeEngine([engine('a', false)])).toBeNull();
  });
});

describe('normalizeCode', () => {
  it('drops spaces, controls and bidi marks; caps at 64', () => {
    expect(normalizeCode(' 729 0000‏00001\n7 ')).toBe('7290000000017');
    expect(normalizeCode('   ')).toBe('');
    expect(normalizeCode('x'.repeat(100))).toHaveLength(64);
  });
});

describe('scanFrames', () => {
  it('skips unready frames, bad frames and empty reads, then returns the code', async () => {
    let n = 0;
    const engine: BarcodeEngine = {
      id: 't',
      isSupported: async () => true,
      detect: async () => {
        n += 1;
        if (n === 1) throw new Error('bad frame');
        if (n === 2) return [{ rawValue: '  ', format: 'ean_13' }];
        return [{ rawValue: ' 123 ', format: 'code_128' }];
      },
    };
    let grabs = 0;
    const hit = await scanFrames(engine, () => (grabs++ === 0 ? null : frame), { signal: new AbortController().signal, intervalMs: 1 });
    expect(hit).toEqual({ rawValue: '123', format: 'code_128' });
  });
  it('returns null once aborted', async () => {
    const ac = new AbortController();
    const engine: BarcodeEngine = { id: 't', isSupported: async () => true, detect: async () => [] };
    const pending = scanFrames(engine, () => frame, { signal: ac.signal, intervalMs: 10_000 });
    ac.abort();
    expect(await pending).toBeNull();
  });
});

describe('classifyCameraError', () => {
  it('permission → denied; anything else → failed', () => {
    expect(classifyCameraError({ name: 'NotAllowedError' })).toBe('denied');
    expect(classifyCameraError({ name: 'SecurityError' })).toBe('denied');
    expect(classifyCameraError({ name: 'NotFoundError' })).toBe('failed');
    expect(classifyCameraError(null)).toBe('failed');
  });
});

/** A mocked SpeechRecognition whose last instance the test drives. */
function mockRecognition() {
  const instances: Array<RecognitionLike & { started: boolean }> = [];
  class Rec implements RecognitionLike {
    lang = '';
    interimResults = false;
    continuous = true;
    maxAlternatives = 5;
    onresult: RecognitionLike['onresult'] = null;
    onerror: RecognitionLike['onerror'] = null;
    onend: RecognitionLike['onend'] = null;
    started = false;
    constructor() {
      instances.push(this);
    }
    start() {
      this.started = true;
    }
    stop() {
      this.onend?.();
    }
    abort() {
      this.onerror?.({ error: 'aborted' });
      this.onend?.();
    }
  }
  const result = (transcript: string, isFinal: boolean) => Object.assign([{ transcript }], { isFinal });
  return { Rec, instances, result };
}

describe('speech', () => {
  it('finds SpeechRecognition or the webkit prefix', () => {
    const { Rec } = mockRecognition();
    expect(speechRecognitionCtor({ SpeechRecognition: Rec })).toBe(Rec);
    expect(speechRecognitionCtor({ webkitSpeechRecognition: Rec })).toBe(Rec);
    expect(speechRecognitionCtor({})).toBeNull();
  });
  it('classifies errors', () => {
    expect(classifySpeechError('not-allowed')).toBe('denied');
    expect(classifySpeechError('network')).toBe('offline');
    expect(classifySpeechError('no-speech')).toBe('noSpeech');
    expect(classifySpeechError('audio-capture')).toBe('failed');
  });
  it('configures he-IL, streams interim text and delivers the final transcript once', () => {
    const { Rec, instances, result } = mockRecognition();
    const onDone = vi.fn();
    const onInterim = vi.fn();
    const session = startDictation(Rec, { onDone, onInterim });
    const rec = instances[0]!;
    expect([rec.lang, rec.interimResults, rec.continuous, rec.started]).toEqual(['he-IL', true, false, true]);
    rec.onresult?.({ resultIndex: 0, results: Object.assign([result('שלושה ארגזים', false)]) });
    expect(onInterim).toHaveBeenLastCalledWith('שלושה ארגזים');
    rec.onresult?.({ resultIndex: 0, results: Object.assign([result('שלושה ארגזים עגבניות', true)]) });
    session.stop();
    rec.onend?.();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith({ ok: true, text: 'שלושה ארגזים עגבניות' });
  });
  it('reports silence and permission refusal', () => {
    const { Rec, instances } = mockRecognition();
    const silent = vi.fn();
    startDictation(Rec, { onDone: silent }).stop();
    expect(silent).toHaveBeenCalledWith({ ok: false, reason: 'noSpeech' });
    const denied = vi.fn();
    startDictation(Rec, { onDone: denied });
    instances[1]!.onerror?.({ error: 'not-allowed' });
    instances[1]!.onend?.();
    expect(denied).toHaveBeenCalledWith({ ok: false, reason: 'denied' });
  });
  it('abort never delivers a transcript', () => {
    const { Rec } = mockRecognition();
    const onDone = vi.fn();
    startDictation(Rec, { onDone }).abort();
    expect(onDone).not.toHaveBeenCalled();
  });
});

// Loosely typed createElement: two @types/react majors are hoisted in the workspace (STATE.md).
const h = createElement as unknown as (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => ReactElement;
const render = (el: ReactElement, locale: AppLocale = 'he') => renderToStaticMarkup(h(I18nProvider, { locale }, el));

describe('ScanButton / MicButton render', () => {
  const noop = () => undefined;
  it('ScanButton: 56 px full-width thumb target, Hebrew label, panel closed, no ₪', () => {
    const html = render(createElement(ScanButton, { onCode: noop }));
    expect(html).toContain('min-h-14');
    expect(html).toContain('w-full');
    expect(html).toContain(he.field.scan.button);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/<div id="[^"]+" hidden=""/);
    expect(html).not.toContain('₪');
  });
  it('ScanButton: the manual fallback is a labelled numeric field with a 56 px confirm', () => {
    const html = render(createElement(ScanButton, { onCode: noop, initialMode: 'manual', initialNotice: 'unsupported' }));
    expect(html).toContain(he.field.scan.unsupported);
    expect(html).toContain(he.field.scan.manualLabel);
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('type="submit"');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('₪');
    expect(html).not.toContain('dir="ltr"');
  });
  it('MicButton: 56 px, English label in en', () => {
    const html = render(createElement(MicButton, { onTranscript: noop }), 'en');
    expect(html).toContain('min-h-14');
    expect(html).toContain(en.field.mic.button);
  });
  it('MicButton: the confirm panel shows the transcript, editable, before any write', () => {
    const onTranscript = vi.fn();
    const html = render(createElement(MicButton, { onTranscript, initialMode: 'confirm', initialText: 'שלושה ארגזים' }));
    expect(html).toContain(he.field.mic.confirmLabel);
    expect(html).toMatch(/<textarea[^>]*>שלושה ארגזים<\/textarea>/);
    expect(html).toContain(he.field.mic.confirm);
    expect(html).toContain(he.field.mic.retry);
    expect(onTranscript).not.toHaveBeenCalled();
    expect(html).not.toContain('₪');
  });
  it('receiver locales read their own overlay, not the Hebrew fallback', () => {
    const html = render(createElement(ScanButton, { onCode: noop, initialMode: 'manual', initialNotice: 'denied' }), 'ar');
    expect(html).toContain(arCommon.field.scan.button);
    expect(html).toContain(arCommon.field.scan.denied);
    expect(html).not.toContain(he.field.scan.button);
  });
  it('MicButton: typed fallback when unsupported', () => {
    const html = render(createElement(MicButton, { onTranscript: noop, initialMode: 'confirm', initialNotice: 'unsupported' }));
    expect(html).toContain(he.field.mic.unsupported);
    expect(html).toContain(he.field.mic.typedLabel);
  });
});

describe('common.field copy', () => {
  const keys = (o: object, p = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [p + k] : keys(v as object, `${p}${k}.`)));
  it('he/en parity, no ₪, no slash forms', () => {
    expect(keys(he.field).sort()).toEqual(keys(en.field).sort());
    for (const s of [...Object.values(he.field.scan), ...Object.values(he.field.mic)]) {
      expect(s).not.toContain('₪');
      expect(s).not.toMatch(/\S\/\S/);
    }
  });
});
