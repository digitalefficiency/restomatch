'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Lock } from 'lucide-react';
import { Button, StatusChip, cn, useAnnounce } from '@/lib/components';
import { DateTime, Money } from '@/lib/components/money';
import { useLocale, useT } from '@/lib/i18n/client';
import { settings } from '@/lib/i18n/messages/settings';
import { localizeServerError } from '@/lib/serverErrors';
import { trpc } from '@/lib/trpc/client';
import { NumberStepper } from '../_components/controls';
import { useMarkUnsaved } from '../_components/SettingsFrame';
import { SectionFoot, SettingRow, SettingsRows, SubHead } from '../_components/ui';
import {
  ALL_FIELDS,
  APPROVAL_FIELDS,
  OCR_FIELD,
  TOLERANCE_FIELDS,
  canStep,
  changesOf,
  errorOf,
  fieldDef,
  intentOf,
  isDirty,
  isFieldDirty,
  sameAsSnapshot,
  savePatch,
  savedAfter,
  stepValue,
  toDisplay,
  toStored,
  undoPatch,
  valuesFrom,
  valuesOfAudit,
  type Defaults,
  type FieldDef,
  type FieldKey,
  type FormValues,
  type StoredKnobs,
  type UpdatePatch,
} from './model';

/** The undo window after a save (README "Rules every package keeps": 10 s where the proposal shows one). */
const UNDO_MS = 10_000;
/** The preview waits for the steppers to rest. */
const PREVIEW_DEBOUNCE_MS = 400;
/** The history shows the latest this many changes (settings.history's own maximum). */
const HISTORY_LIMIT = 100;
/**
 * Fields whose LOWER value can open gaps that are not open today (a smaller
 * tolerance, a smaller cumulative routing threshold). The preview cannot count
 * those — they are not rows yet — so it says so instead of a number.
 */
const OPENS_MORE_WHEN_LOWER: ReadonlySet<FieldKey> = new Set<FieldKey>([
  'pricePercent',
  'priceAbsolute',
  'qtyPercent',
  'qtyAbsolute',
  'cumulativeLargeAmount',
  'cumulativeLargePct',
  'cumulativeMediumAmountMin',
  'cumulativeMediumPctMin',
]);

export interface HistoryRow {
  id: string;
  kind: 'rules' | 'profile';
  at: Date;
  byName: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

type T = (key: string, vars?: Record<string, string | number>) => string;

/** A template's `{name}` placeholders replaced by React nodes (₪, dates) — the text stays in the catalog. */
function fill(template: string, parts: Record<string, React.ReactNode>): React.ReactNode[] {
  return template.split(/(\{[a-zA-Z]+\})/).map((piece, i) => {
    const m = /^\{([a-zA-Z]+)\}$/.exec(piece);
    return m && m[1]! in parts ? <span key={i}>{parts[m[1]!]}</span> : <span key={i}>{piece}</span>;
  });
}

/** A stored value as people read it: 7.5%, ₪ through the money component, units as a number. */
function ValueText({ f, stored }: { f: FieldDef; stored: number }) {
  if (f.kind === 'currency') return <Money value={stored} context="line" className="font-medium" />;
  return (
    <bdi className="num font-medium">
      {toDisplay(stored, f.kind)}
      {f.kind === 'percent' ? '%' : ''}
    </bdi>
  );
}

function useDebounced<V>(value: V, ms: number): V {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * כללי התאמה ואישור — the restaurant's thresholds with today's save model
 * (one settings.update, audited as settings.updated), plus DS3-06: a marker per
 * field (ברירת מחדל / הותאם / לא נשמר), "חזרה לברירת המחדל", the save bar, ten
 * seconds to undo, the history of who changed what and when, restore as an
 * unsaved change, and — before saving — what the change WOULD have done to the
 * gaps open now, computed by the matching engine on the server.
 */
export function RulesForm({
  initial,
  defaults,
  history: initialHistory,
  canEdit,
}: {
  initial: StoredKnobs;
  defaults: Defaults;
  history: HistoryRow[];
  canEdit: boolean;
}) {
  const t = useT(settings) as unknown as T;
  const locale = useLocale();
  const announce = useAnnounce();
  const utils = trpc.useUtils();

  const [saved, setSaved] = useState<FormValues>(() => valuesFrom(initial));
  const [values, setValues] = useState<FormValues>(saved);
  const [undo, setUndo] = useState<{ before: FormValues; after: FormValues } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** Where focus goes when the bar it was in goes away (after discard, or when the undo window ends). */
  const focusFirstField = useCallback(() => document.getElementById(`set-${TOLERANCE_FIELDS[0]!.key}`)?.focus(), []);

  const dirty = canEdit && isDirty(values, saved, defaults);
  useMarkUnsaved('rules', dirty);

  // Leave guard: unsaved rule changes are lost on a reload or a tab close.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const errors = useMemo(() => {
    const out: Partial<Record<FieldKey, ReturnType<typeof errorOf>>> = {};
    for (const f of ALL_FIELDS) out[f.key] = errorOf(values[f.key], f);
    return out;
  }, [values]);
  const hasErrors = Object.values(errors).some(Boolean);

  const historyQuery = trpc.settings.history.useQuery({ limit: HISTORY_LIMIT }, { initialData: initialHistory });
  const historyAll = historyQuery.data ?? initialHistory;
  const history = historyAll.filter((h) => h.kind === 'rules');
  /** The server returned its maximum: older changes may exist, so the count is not the total. */
  const historyCapped = historyAll.length >= HISTORY_LIMIT;

  const refreshAfterWrite = useCallback(() => {
    void utils.settings.history.invalidate();
    void utils.settings.effective.invalidate();
    void utils.settings.previewThresholds.invalidate();
  }, [utils]);

  const update = trpc.settings.update.useMutation();

  const set = (key: FieldKey, raw: string | null) => {
    setUndo(null);
    setFailure(null);
    setValues((v) => ({ ...v, [key]: raw === null || raw.trim() === '' ? null : raw }));
  };

  const doSave = () => {
    const patch = savePatch(values, saved, defaults);
    if (!patch || hasErrors) return;
    const before = saved;
    const after = savedAfter(values, saved, defaults);
    setFailure(null);
    update.mutate(patch, {
      onSuccess: () => {
        setSaved(after);
        setValues(after);
        setUndo({ before, after });
        announce(t('thresholds.save.sr.saved'));
        refreshAfterWrite();
      },
      onError: (err) => setFailure(localizeServerError(err, locale, t('thresholds.save.failed'))),
    });
  };

  const doUndo = () => {
    if (!undo) return;
    const patch: UpdatePatch | null = undoPatch(undo.before, undo.after);
    const target = undo.before;
    setUndo(null);
    if (!patch) return;
    update.mutate(patch, {
      onSuccess: () => {
        setSaved(target);
        setValues(target);
        announce(t('thresholds.save.sr.undone'));
        refreshAfterWrite();
      },
      onError: (err) => setFailure(localizeServerError(err, locale, t('thresholds.save.failed'))),
    });
  };

  const doDiscard = () => {
    setValues(saved);
    setFailure(null);
    announce(t('thresholds.save.sr.discarded'));
    focusFirstField();
  };

  /* ── the preview: what the unsaved thresholds would have done to the gaps open now ──
     Only the owner (the one who can save) asks the what-if; everyone else reads
     the count in force ({}), which is all the server answers them. */
  const thresholdPatch = useMemo(() => {
    if (!canEdit || hasErrors) return {};
    const p = savePatch(values, saved, defaults);
    return { ...(p?.tolerances ? { tolerances: p.tolerances } : {}), ...(p?.approvalThresholds ? { approvalThresholds: p.approvalThresholds } : {}) };
  }, [canEdit, hasErrors, values, saved, defaults]);
  const previewInput = useDebounced(thresholdPatch, PREVIEW_DEBOUNCE_MS);
  const preview = trpc.settings.previewThresholds.useQuery(previewInput, {
    placeholderData: (p) => p,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const thresholdsUnsaved = Object.keys(thresholdPatch).length > 0;
  /** The answer on screen is for other values than the fields hold (typing, or the request still out). */
  const previewStale = previewInput !== thresholdPatch || preview.isPlaceholderData;
  /** Some unsaved value is lower where lower can open gaps that are not open today. */
  const opensMore = useMemo(() => {
    if (!canEdit || hasErrors) return false;
    return [...TOLERANCE_FIELDS, ...APPROVAL_FIELDS].some((f) => {
      if (!OPENS_MORE_WHEN_LOWER.has(f.key)) return false;
      const now = saved[f.key] === null ? defaults[f.key] : toStored(saved[f.key]!, f.kind);
      const intent = intentOf(values, saved, defaults, f);
      const next = intent === null ? defaults[f.key] : intent;
      return Number.isFinite(next) && Number.isFinite(now) && next < now - 1e-9;
    });
  }, [canEdit, hasErrors, values, saved, defaults]);

  /* ── field rows ── */
  const chipFor = (fields: FieldDef[]) => {
    if (canEdit && fields.some((f) => isFieldDirty(values, saved, defaults, f))) {
      return <StatusChip tone="warn" label={t('thresholds.unsaved')} />;
    }
    return fields.some((f) => saved[f.key] !== null) ? (
      <StatusChip tone="info" label={t('thresholds.custom')} icon={null} />
    ) : (
      <StatusChip tone="neutral" label={t('thresholds.default')} icon={null} />
    );
  };

  const restoreFor = (fields: FieldDef[], label: string) =>
    canEdit && fields.some((f) => values[f.key] !== null) ? (
      <button
        type="button"
        onClick={() => {
          setUndo(null);
          setValues((v) => {
            const next = { ...v };
            for (const f of fields) next[f.key] = null;
            return next;
          });
          announce(t('thresholds.save.sr.defaulted'));
        }}
        aria-label={t('thresholds.restoreDefaultAria', { field: label })}
        className="inline-flex min-h-6 items-center text-caption font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary [@media(pointer:coarse)]:min-h-11"
      >
        {t('thresholds.restoreDefault')}
      </button>
    ) : null;

  const stepper = (f: FieldDef, label: string, describedBy?: string) => {
    const raw = values[f.key];
    const shown = raw ?? toDisplay(defaults[f.key], f.kind);
    return (
      <NumberStepper
        key={f.key}
        id={`set-${f.key}`}
        value={shown}
        onChange={(v) => set(f.key, v)}
        onStep={(d) => set(f.key, stepValue(values, defaults, f, d))}
        canDecrease={canStep(values, defaults, f, -1)}
        canIncrease={canStep(values, defaults, f, 1)}
        unit={f.kind === 'percent' ? '%' : f.kind === 'currency' ? '₪' : ''}
        label={label}
        lessLabel={t('thresholds.lessAria', { field: label })}
        moreLabel={t('thresholds.moreAria', { field: label })}
        disabled={!canEdit}
        invalid={!!errors[f.key]}
        describedBy={describedBy}
      />
    );
  };

  const errorLine = (fields: FieldDef[]) => {
    const err = fields.map((f) => errors[f.key]).find(Boolean);
    return err ? (
      <span role="alert" className="text-caption font-medium text-danger">
        {t(`matching.${err}`)}
      </span>
    ) : null;
  };

  const thresholdRow = (f: FieldDef) => {
    const label = t(`thresholds.fields.${f.key}.label`);
    const hintId = `hint-${f.key}`;
    return (
      <SettingRow
        key={f.key}
        id={f.key}
        label={
          <>
            {label}
            {chipFor([f])}
            {restoreFor([f], label)}
          </>
        }
        hint={
          <>
            <span id={hintId}>{t(`thresholds.fields.${f.key}.hint`)}</span> {errorLine([f])}
          </>
        }
        control={stepper(f, label, hintId)}
      />
    );
  };

  /* ── the approvals engine's rules, all of them (KNOWN-ISSUES #4) ── */
  const approvalRow = (id: string, keys: FieldKey[]) => {
    const fields = keys.map(fieldDef);
    const label = t(`thresholds.approvals.${id}.label`);
    return (
      <SettingRow
        key={id}
        id={id === 'noPo' ? 'approvals' : `rule-${id}`}
        label={
          <>
            {label}
            {fields.length ? chipFor(fields) : null}
            {fields.length ? restoreFor(fields, label) : null}
          </>
        }
        hint={
          <>
            {t(`thresholds.approvals.${id}.hint`)} {errorLine(fields)}
          </>
        }
        control={
          fields.length ? (
            fields.map((f) =>
              stepper(f, `${label}: ${t(f.kind === 'percent' ? 'thresholds.approvals.percent' : 'thresholds.approvals.amount')}`),
            )
          ) : (
            <span className="text-body-sm text-muted">{t('thresholds.fixed')}</span>
          )
        }
      />
    );
  };

  const anyAction = canEdit && (dirty || !!undo);

  return (
    <div className="space-y-2">
      {!canEdit ? (
        <p className="mb-4 flex items-center gap-2 rounded-card bg-surface-2 px-4 py-3 text-body-sm text-muted">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t('readOnly.matching')}
        </p>
      ) : null}

      <SubHead>{t('thresholds.tolerancesTitle')}</SubHead>
      <SettingsRows>{TOLERANCE_FIELDS.map(thresholdRow)}</SettingsRows>

      <EffectBox
        t={t}
        locale={locale}
        unsaved={thresholdsUnsaved}
        data={preview.isError ? null : (preview.data ?? null)}
        failed={preview.isError}
        stale={previewStale && !preview.isError}
        opensMore={opensMore}
      />

      <SubHead>{t('thresholds.approvalsTitle')}</SubHead>
      <SettingsRows data-testid="rules-in-force">
        {approvalRow('duplicate', [])}
        {approvalRow('noPo', ['largeInvoiceWithoutPo'])}
        {approvalRow('unordered', ['unorderedItemSignificant'])}
        {approvalRow('blocking', [])}
        {approvalRow('cumulativeLarge', ['cumulativeLargeAmount', 'cumulativeLargePct'])}
        {approvalRow('cumulativeMedium', ['cumulativeMediumAmountMin', 'cumulativeMediumPctMin'])}
        {approvalRow('minor', [])}
        {approvalRow('fallback', [])}
        {thresholdRow(OCR_FIELD)}
      </SettingsRows>
      <SectionFoot>
        <span>{t('thresholds.fixedNote')}</span>
      </SectionFoot>

      <HistoryBlock
        t={t}
        rows={history}
        capped={historyCapped}
        open={historyOpen}
        onToggle={() => setHistoryOpen((o) => !o)}
        canRestore={canEdit && !dirty && !undo}
        saved={saved}
        onRestore={(row) => {
          setValues(valuesOfAudit(row.before));
          announce(t('thresholds.save.sr.restored'));
        }}
      />

      {failure ? (
        <p role="alert" className="text-body-sm font-medium text-danger">
          {failure}
        </p>
      ) : null}

      {anyAction ? (
        undo ? (
          <UndoBar t={t} onUndo={doUndo} onEnd={() => setUndo(null)} returnFocus={focusFirstField} />
        ) : (
          <div
            role="region"
            aria-label={t('thresholds.save.dirty')}
            data-testid="settings-dirty-bar"
            className="sticky bottom-[calc(var(--rm-bottomnav-h,0px)+var(--consent-h,0px)+theme(spacing.4))] z-10 flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 shadow-e2"
          >
            <span className="text-body-sm font-medium text-ink">{t('thresholds.save.dirty')}</span>
            {hasErrors ? <span className="text-caption text-danger">{t('thresholds.save.invalid')}</span> : null}
            <span className="flex-1" />
            <Button type="button" variant="ghost" size="sm" onClick={doDiscard}>
              {t('thresholds.save.discardCta')}
            </Button>
            <Button type="button" variant="primary" size="sm" loading={update.isPending} disabled={hasErrors} onClick={doSave}>
              {t('thresholds.save.saveCta')}
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}

/**
 * "נשמר לכל המסעדה, ונרשם בהיסטוריה · ביטול" for ten seconds, with the time left
 * as a shrinking line that pauses under the pointer or focus (SPEC §8); under
 * reduced motion the line is not drawn, the window is the same.
 */
function UndoBar({ t, onUndo, onEnd, returnFocus }: { t: T; onUndo: () => void; onEnd: () => void; returnFocus: () => void }) {
  const line = useRef<HTMLDivElement | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);
  const timer = useRef<{ id: ReturnType<typeof setTimeout> | null; left: number; since: number }>({ id: null, left: UNDO_MS, since: 0 });
  const anim = useRef<Animation | null>(null);

  const end = useCallback(() => {
    const hadFocus = !!bar.current && bar.current.contains(document.activeElement);
    onEnd();
    if (hadFocus) requestAnimationFrame(returnFocus);
  }, [onEnd, returnFocus]);

  const run = useCallback(() => {
    const tm = timer.current;
    if (tm.id) return;
    tm.since = Date.now();
    tm.id = setTimeout(end, tm.left);
    anim.current?.play();
  }, [end]);

  const pause = useCallback(() => {
    const tm = timer.current;
    if (!tm.id) return;
    clearTimeout(tm.id);
    tm.id = null;
    tm.left = Math.max(0, tm.left - (Date.now() - tm.since));
    anim.current?.pause();
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (line.current && !reduce && typeof line.current.animate === 'function') {
      anim.current = line.current.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], {
        duration: UNDO_MS,
        easing: 'linear',
        fill: 'forwards',
      });
    }
    run();
    const tm = timer.current;
    return () => {
      if (tm.id) clearTimeout(tm.id);
      anim.current?.cancel();
    };
  }, [run]);

  return (
    <div
      ref={bar}
      role="region"
      aria-label={t('thresholds.save.done')}
      data-testid="settings-undo-bar"
      onPointerEnter={pause}
      onPointerLeave={run}
      onFocusCapture={pause}
      onBlurCapture={(e) => {
        if (!bar.current?.contains(e.relatedTarget as Node | null)) run();
      }}
      className="sticky bottom-[calc(var(--rm-bottomnav-h,0px)+var(--consent-h,0px)+theme(spacing.4))] z-10 flex flex-wrap items-center gap-3 overflow-hidden rounded-card bg-ink px-4 py-3 text-on-bold shadow-e2"
    >
      <span className="text-body-sm font-medium">{t('thresholds.save.done')}</span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={onUndo}
        className="inline-flex min-h-8 items-center rounded-control px-3 text-body-sm font-semibold ring-1 ring-inset ring-on-bold/60 hover:bg-on-bold/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-bold [@media(pointer:coarse)]:min-h-11"
      >
        {t('thresholds.save.undoCta')}
      </button>
      <div ref={line} aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-on-bold/60 ltr:origin-left rtl:origin-right" />
    </div>
  );
}

/** settings.previewThresholds' answer, as this screen reads it (packages/api ThresholdPreview). */
interface PreviewData {
  openNow: number;
  changed: boolean;
  wouldOpen: number;
  wouldBlock: number;
  notOpenedCount: number;
  notOpenedAgorot: number;
  notOpened: Array<{ label: string | null; labelEn: string | null; amountAgorot: number }>;
  notEvaluated: number;
}

/**
 * What the thresholds would do — in conditional words, from the matching
 * engine on the server (settings.previewThresholds). It never says that saving
 * changes a gap that is already open: thresholds act on invoices checked from
 * now on (KNOWN-ISSUES "Settings" #3). While the answer is for other values
 * than the fields hold it is dimmed and marked busy; a failure shows no number.
 */
function EffectBox({
  t,
  locale,
  unsaved,
  data,
  failed,
  stale,
  opensMore,
}: {
  t: T;
  locale: string;
  unsaved: boolean;
  data: PreviewData | null;
  failed: boolean;
  stale: boolean;
  opensMore: boolean;
}) {
  const lines: React.ReactNode[] = [];
  if (data) {
    const n = data.openNow;
    if (!unsaved || !data.changed || n === 0) {
      lines.push(t('thresholds.effect.openNow', { count: n }));
    } else {
      const k = data.wouldOpen;
      if (k === n) lines.push(t('thresholds.effect.all', { n }));
      else if (k === 0) lines.push(t('thresholds.effect.none', { n }));
      else lines.push(t('thresholds.effect.some', { k, n }));
      if (k > 0) lines.push(t('thresholds.effect.blocks', { b: data.wouldBlock }));
      if (data.notOpenedCount > 0) {
        const named = data.notOpened.map((x) => (locale === 'en' ? (x.labelEn ?? x.label) : x.label) ?? t('thresholds.effect.unnamed'));
        const more = data.notOpenedCount - named.length;
        const names = [...named, ...(more > 0 ? [t('thresholds.effect.andMore', { count: more })] : [])].join(', ');
        lines.push(
          data.notOpenedAgorot > 0 ? (
            <>
              {t('thresholds.effect.notOpened', { count: data.notOpenedCount, names })},{' '}
              <Money agorot={data.notOpenedAgorot} context="line" className="font-semibold" /> {t('thresholds.effect.beforeVat')}
            </>
          ) : (
            t('thresholds.effect.notOpened', { count: data.notOpenedCount, names })
          ),
        );
      }
      if (data.notEvaluated > 0) lines.push(t('thresholds.effect.notEvaluated', { count: data.notEvaluated }));
    }
  }
  return (
    <div
      data-testid="threshold-effect"
      data-stale={stale || undefined}
      aria-busy={stale || undefined}
      className="mt-3 grid gap-0.5 rounded-card bg-surface-2 px-4 py-3"
    >
      <h3 className="flex items-center gap-2 text-caption font-medium text-muted">
        {unsaved ? t('thresholds.effect.titleUnsaved') : t('thresholds.effect.titleSaved')}
        {stale ? (
          <span aria-hidden="true" className="font-normal">
            {t('thresholds.effect.computing')}
          </span>
        ) : null}
      </h3>
      {failed ? <p className="text-body-sm text-muted">{t('thresholds.effect.failed')}</p> : null}
      {lines.map((l, i) => (
        <p key={i} className={cn('text-body-sm text-ink transition-opacity duration-short', stale && 'opacity-60')}>
          {l}
        </p>
      ))}
      {unsaved ? (
        <>
          {opensMore ? <p className="mt-1 text-caption text-muted">{t('thresholds.effect.stricter')}</p> : null}
          <p className={cn('text-caption text-muted', !opensMore && 'mt-1')}>{t('thresholds.effect.newOnly')}</p>
          <p className="text-caption text-muted">{t('thresholds.effect.openStay')}</p>
        </>
      ) : (
        <p className="mt-1 text-caption text-muted">{t('thresholds.effect.savedApply')}</p>
      )}
      {stale ? <span className="sr-only">{t('thresholds.effect.busySr')}</span> : null}
    </div>
  );
}

/** Who changed the rules, when and what — and the previous values one click away (restored unsaved). */
function HistoryBlock({
  t,
  rows,
  capped,
  open,
  onToggle,
  canRestore,
  saved,
  onRestore,
}: {
  t: T;
  rows: HistoryRow[];
  /** The server's maximum came back: say "the latest", never a total. */
  capped: boolean;
  open: boolean;
  onToggle: () => void;
  canRestore: boolean;
  saved: FormValues;
  onRestore: (row: HistoryRow) => void;
}) {
  const last = rows[0];
  const lastTemplate = t('thresholds.history.last');
  const changeTemplate = t('thresholds.history.change');
  const defaultTemplate = t('thresholds.history.defaultValue');
  const value = (f: FieldDef, stored: number | null, fallback: number | null) =>
    stored === null ? (
      fallback === null ? (
        t('thresholds.default')
      ) : (
        <>{fill(defaultTemplate, { value: <ValueText f={f} stored={fallback} /> })}</>
      )
    ) : (
      <ValueText f={f} stored={stored} />
    );

  return (
    <div className="mt-4 space-y-1" data-testid="rules-history">
      {last ? (
        <p className="text-caption text-muted">
          {fill(lastTemplate, { name: <bdi className="text-ink">{last.byName ?? t('thresholds.history.unknownUser')}</bdi>, when: <DateTime value={last.at} variant="datetime" className="text-ink" /> })}
        </p>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="rules-history-list"
        onClick={onToggle}
        className="-ms-2 inline-flex min-h-8 items-center gap-1 rounded-control px-2 text-caption font-medium text-muted hover:bg-surface-2 hover:text-ink [@media(pointer:coarse)]:min-h-11"
      >
        {capped ? t('thresholds.history.toggleLatest') : t('thresholds.history.toggle', { n: rows.length })}
        <ChevronDown className={cn('h-4 w-4 transition-transform duration-short', open && 'rotate-180')} aria-hidden="true" />
      </button>
      <ul id="rules-history-list" hidden={!open} className="space-y-2">
        {rows.length === 0 ? <li className="text-caption text-muted">{t('thresholds.history.empty')}</li> : null}
        {rows.map((row, i) => {
          const changes = changesOf(row.before, row.after);
          const restorable = i === 0 && canRestore && !!row.before && sameAsSnapshot(saved, row.after);
          return (
            <li key={row.id} className="grid gap-x-3 text-caption text-muted sm:grid-cols-[auto_auto_minmax(0,1fr)]">
              <DateTime value={row.at} variant="datetime" className="text-ink" />
              <bdi>{row.byName ?? t('thresholds.history.unknownUser')}</bdi>
              <span>
                {changes.length === 0
                  ? t('thresholds.history.noChange')
                  : changes.map((c, j) => {
                      const f = fieldDef(c.key);
                      return (
                        <span key={c.key}>
                          {j > 0 ? ', ' : null}
                          {fill(changeTemplate, {
                            field: f.group === 'approvalThresholds' ? labelOfApprovalKey(t, c.key) : t(`thresholds.fields.${c.key}.label`),
                            from: value(f, c.from, null),
                            to: value(f, c.to, null),
                          })}
                        </span>
                      );
                    })}
                {restorable ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      onClick={() => onRestore(row)}
                      className="inline-flex min-h-6 items-center font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary [@media(pointer:coarse)]:min-h-11"
                    >
                      {t('thresholds.history.restoreCta')}
                    </button>
                  </>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Approval knobs have no field label of their own: "<rule>: <amount|share>". */
function labelOfApprovalKey(t: T, key: FieldKey): string {
  const rule: Record<string, string> = {
    largeInvoiceWithoutPo: 'noPo',
    unorderedItemSignificant: 'unordered',
    cumulativeLargeAmount: 'cumulativeLarge',
    cumulativeLargePct: 'cumulativeLarge',
    cumulativeMediumAmountMin: 'cumulativeMedium',
    cumulativeMediumPctMin: 'cumulativeMedium',
  };
  const f = fieldDef(key);
  const r = rule[key];
  if (!r) return key;
  return `${t(`thresholds.approvals.${r}.label`)}: ${t(f.kind === 'percent' ? 'thresholds.approvals.percent' : 'thresholds.approvals.amount')}`;
}
