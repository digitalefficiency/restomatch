'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { common } from '@/lib/i18n/messages/common';
import { Button } from '../Button';
import { Field, Textarea } from '../Input';
import { cnMerge as cn } from '../cn';
import { speechRecognitionCtor, startDictation, type RecognitionCtor, type SpeechFailure } from './speech';

export type MicNotice = 'unsupported' | SpeechFailure;
export interface MicMeta {
  /** `voice` = dictated then confirmed (maybe edited); `typed` = the fallback field. */
  source: 'voice' | 'typed';
}

export interface MicButtonProps {
  /** Called only after the person confirms the transcript. Never on raw speech. */
  onTranscript: (text: string, meta: MicMeta) => void;
  /** BCP-47 language for recognition. Default `he-IL`. */
  lang?: string;
  /** Recognition constructor; defaults to the browser's (null → typed fallback). */
  recognition?: RecognitionCtor | null;
  label?: string;
  disabled?: boolean;
  className?: string;
  /** Initial panel — tests and the showcase only. */
  initialMode?: 'idle' | 'confirm';
  initialText?: string;
  initialNotice?: MicNotice | null;
}

type Mode = 'idle' | 'listening' | 'confirm';

/**
 * Field speech-to-text (W3-03a). A 56 px thumb button. What was heard is
 * always shown, editable, and written only on "אישור". Unsupported, denied,
 * offline or silent → the same panel as a typed field. Shows no ₪.
 */
export function MicButton({
  onTranscript,
  lang = 'he-IL',
  recognition,
  label,
  disabled,
  className,
  initialMode = 'idle',
  initialText = '',
  initialNotice = null,
}: MicButtonProps) {
  const t = useT(common);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [notice, setNotice] = useState<MicNotice | null>(initialNotice);
  const [caption, setCaption] = useState('');
  const [text, setText] = useState(initialText);
  const [voiced, setVoiced] = useState(initialText !== '');
  const [emptyError, setEmptyError] = useState(false);
  const sessionRef = useRef<{ stop(): void; abort(): void } | null>(null);
  const panelId = useId();

  useEffect(() => () => sessionRef.current?.abort(), []);

  const toConfirm = (heard: string | null, why: MicNotice | null) => {
    sessionRef.current = null;
    setNotice(why);
    setText(heard ?? '');
    setVoiced(heard !== null);
    setEmptyError(false);
    setMode('confirm');
  };

  function start() {
    const Ctor = recognition === undefined ? speechRecognitionCtor() : recognition;
    if (!Ctor) return toConfirm(null, 'unsupported');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return toConfirm(null, 'offline');
    setNotice(null);
    setCaption('');
    setMode('listening');
    sessionRef.current = startDictation(Ctor, {
      lang,
      onInterim: setCaption,
      onDone: (outcome) => (outcome.ok ? toConfirm(outcome.text, null) : toConfirm(null, outcome.reason)),
    });
  }

  const cancel = () => {
    sessionRef.current?.abort();
    sessionRef.current = null;
    setMode('idle');
    setNotice(null);
    setText('');
    setEmptyError(false);
  };

  const confirm = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return setEmptyError(true);
    onTranscript(clean, { source: voiced ? 'voice' : 'typed' });
    setMode('idle');
    setText('');
    setNotice(null);
  };

  const listening = mode === 'listening';
  return (
    <div className={cn('flex flex-col gap-3', className)} data-field="mic">
      <Button
        type="button"
        variant={listening ? 'danger' : 'secondary'}
        size="xl"
        fullWidth
        disabled={disabled}
        pressed={listening}
        aria-controls={panelId}
        aria-expanded={mode !== 'idle'}
        icon={listening ? <Square className="h-5 w-5" aria-hidden="true" /> : <Mic className="h-6 w-6" aria-hidden="true" />}
        className={listening ? undefined : 'border-2 border-line-strong'}
        onClick={() => (listening ? sessionRef.current?.stop() : mode === 'idle' ? start() : cancel())}
      >
        {listening ? t('field.mic.stop') : (label ?? t('field.mic.button'))}
      </Button>

      <p role="status" aria-live="polite" className="text-body-sm text-ink empty:hidden">
        {notice ? t(`field.mic.${notice}`) : listening ? t('field.mic.listening') : ''}
      </p>

      <div id={panelId} hidden={mode === 'idle'} className="flex flex-col gap-3">
        {listening && caption && <p className="rounded-card border-2 border-line-strong bg-surface p-3 text-body text-ink">{caption}</p>}
        {mode === 'confirm' && (
          <form onSubmit={confirm} className="flex flex-col gap-3" noValidate>
            <Field label={voiced ? t('field.mic.confirmLabel') : t('field.mic.typedLabel')} error={emptyError ? t('field.mic.empty') : undefined}>
              <Textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} autoFocus className="text-body" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Button type="submit" variant="primary" size="xl">
                {t('field.mic.confirm')}
              </Button>
              {notice === 'unsupported' || notice === 'denied' || notice === 'offline' ? (
                <Button type="button" variant="ghost" size="xl" onClick={cancel}>
                  {t('field.mic.cancel')}
                </Button>
              ) : (
                <Button type="button" variant="secondary" size="xl" onClick={start}>
                  {t('field.mic.retry')}
                </Button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
