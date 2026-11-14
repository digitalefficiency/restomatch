/**
 * Speech-to-text wrapper (W3-03a). Uses `SpeechRecognition` /
 * `webkitSpeechRecognition` where the browser has it. The caller always shows
 * the transcript for confirmation before anything is written (MicButton).
 */

interface AlternativeLike {
  transcript: string;
}
interface ResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: AlternativeLike;
}
interface ResultEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: ResultLike };
}

export interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: ResultEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type RecognitionCtor = new () => RecognitionLike;

/** The constructor, or null when the browser has no speech recognition. */
export function speechRecognitionCtor(scope: unknown = globalThis): RecognitionCtor | null {
  const s = scope as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown } | undefined;
  const C = s?.SpeechRecognition ?? s?.webkitSpeechRecognition;
  return typeof C === 'function' ? (C as RecognitionCtor) : null;
}

export type SpeechFailure = 'denied' | 'offline' | 'noSpeech' | 'failed';

export function classifySpeechError(code: string): SpeechFailure {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'denied';
  if (code === 'network') return 'offline';
  if (code === 'no-speech' || code === 'aborted') return 'noSpeech';
  return 'failed';
}

export interface DictationHandlers {
  /** The running transcript (final + interim) — for the live caption. */
  onInterim?: (text: string) => void;
  /** Exactly once per session: the final transcript, or a failure. */
  onDone: (outcome: { ok: true; text: string } | { ok: false; reason: SpeechFailure }) => void;
}

/** Starts one dictation session. `stop()` ends it and delivers what was heard. */
export function startDictation(
  Ctor: RecognitionCtor,
  { lang = 'he-IL', ...handlers }: DictationHandlers & { lang?: string },
): { stop(): void; abort(): void } {
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  const finals: string[] = [];
  let failure: SpeechFailure | null = null;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    const text = finals.join(' ').replace(/\s+/g, ' ').trim();
    if (failure) handlers.onDone({ ok: false, reason: failure });
    else if (text) handlers.onDone({ ok: true, text });
    else handlers.onDone({ ok: false, reason: 'noSpeech' });
  };

  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const said = result?.[0]?.transcript ?? '';
      if (result?.isFinal) finals[i] = said.trim();
      else interim += said;
    }
    handlers.onInterim?.([...finals.filter(Boolean), interim.trim()].filter(Boolean).join(' '));
  };
  rec.onerror = (event) => {
    failure = classifySpeechError(event.error);
  };
  rec.onend = finish;

  try {
    rec.start();
  } catch {
    failure = 'failed';
    finish();
  }
  return {
    stop: () => {
      try {
        rec.stop();
      } catch {
        finish();
      }
    },
    abort: () => {
      done = true;
      try {
        rec.abort();
      } catch {
        /* already ended */
      }
    },
  };
}
