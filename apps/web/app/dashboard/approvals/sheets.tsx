'use client';

/**
 * The desk's two sheets (DS3-04 spec §5.2, §5.9; moved from desk.tsx:265-372): the escalation Sheet ("העבירו
 * לבעלים": four note chips + an optional note, joined to ≤ 300 characters; the owners are notified server-side) and
 * the keyboard help. Both are native modal dialogs (lib/components/overlay/Sheet): DeskView renders them outside the
 * queue and the evidence, so dialog keys never reach the desk handlers, and Esc / close return focus to the opener.
 * Focus is the global :focus-visible outline (DS3 SPEC §4): no per-element ring.
 */
import { useId, useState } from 'react';
import type { he as approvalsHe } from '@/lib/i18n/messages/approvals/he';
import type { Translator } from '@/lib/i18n/translate';
import { Button } from '@/lib/components/Button';
import { Textarea } from '@/lib/components/Input';
import { cn } from '@/lib/components/cn';
import { Sheet } from '@/lib/components/overlay/Sheet';

type T = Translator<typeof approvalsHe>;

/* ───────────────────────────── escalation sheet ───────────────────────────── */

const CHIPS = ['escalateChipPrice', 'escalateChipSupplier', 'escalateChipAmount', 'escalateChipUnsure'] as const;

/** "העבר לבעלים": note chips + an optional note; the owners are notified server-side. */
export function EscalateSheet({
  open,
  t,
  busy,
  onClose,
  onSend,
}: {
  open: boolean;
  t: T;
  busy: boolean;
  onClose: () => void;
  onSend: (note: string | undefined) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState('');
  const noteId = useId();
  const note = [...picked, text.trim()].filter(Boolean).join(' · ') || undefined;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('desk.escalateTitle')}
      description={t('desk.escalateDescription')}
      primary={
        <div className="grid grid-cols-2 gap-2">
          <Button size="xl" disabled={busy} onClick={() => onSend(note)} data-testid="escalate-send">
            {t('desk.escalateSend')}
          </Button>
          <Button size="xl" variant="secondary" onClick={onClose}>
            {t('desk.cancel')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('desk.escalateNote')}>
        {CHIPS.map((k) => {
          const label = t(`desk.${k}`);
          const on = picked.includes(label);
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              onClick={() => setPicked((p) => (on ? p.filter((x) => x !== label) : [...p, label]))}
              className={cn(
                'inline-flex min-h-12 items-center rounded-full border px-4 text-sm',
                on ? 'border-primary bg-primary/10 font-semibold text-ink' : 'border-line-strong text-ink',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      <label htmlFor={noteId} className="mt-3 block text-sm font-semibold text-ink">
        {t('desk.escalateNote')}
      </label>
      <Textarea id={noteId} value={text} maxLength={300} onChange={(e) => setText(e.target.value)} className="mt-1" />
    </Sheet>
  );
}

/* ───────────────────────────── keyboard help ───────────────────────────── */

/** Keys on: the note first, then every key in the desk's order (Esc is new). */
const KEY_LINES_ON = [
  'desk.keysOnNote',
  'desk.keyNav',
  'desk.keyApprove',
  'desk.keyWaive',
  'desk.keyUndo',
  'desk.keyEsc',
  'desk.keySelect',
  'desk.keyEvidence',
  'desk.keyEscalate',
  'desk.keyHelp',
] as const;
/** Keys off: the other lines name keys that do nothing then (R20); arrows and Esc still work. */
const KEY_LINES_OFF = ['desk.legend.keysOff', 'desk.keyEsc'] as const;

/**
 * "קיצורי מקלדת" (`?`, or the legend's keys button). What it lists follows the single-key preference as drawn
 * (`singleKeys` = usePrefs().singleKeys): on → the note "קיצורים בתו אחד פעילים" and every key; off → only the
 * sentence that they are off and Esc.
 */
export function KeysHelp({
  open,
  t,
  singleKeys,
  onClose,
}: {
  open: boolean;
  t: T;
  singleKeys: boolean;
  onClose: () => void;
}) {
  const lines: ReadonlyArray<(typeof KEY_LINES_ON)[number] | (typeof KEY_LINES_OFF)[number]> = singleKeys
    ? KEY_LINES_ON
    : KEY_LINES_OFF;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('desk.keysTitle')}
      primary={
        <Button size="xl" variant="secondary" onClick={onClose}>
          {t('desk.keysClose')}
        </Button>
      }
    >
      <ul className="space-y-2 text-sm text-ink" data-testid="approvals-keys">
        {lines.map((k) => (
          <li key={k}>
            <bdi>{t(k)}</bdi>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
