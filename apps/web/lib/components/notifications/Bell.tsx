'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bell as BellIcon, X } from 'lucide-react';
import { cn } from '@/lib/components/cn';
import { Icon } from '../icon/Icon';
import { ActivityFeed } from '@/lib/components';
import { Money } from '@/lib/components/money';
import { Sheet } from '@/lib/components/overlay';
import { useMediaQuery } from '@/lib/components/desk/useMediaQuery';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatIls } from '@/lib/money';
import { nav } from '@/lib/i18n/messages/nav';
import { overview } from '@/lib/i18n/messages/overview';
import { trpc } from '@/lib/trpc/client';
import { cappedCount, readSeen, taskSig, unseenCount, writeSeen, type Task } from './model';
import { othersLine, taskRow, type TaskRow } from './rows';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The bell (W2-08 §5.4): the same task spine as the home and the badges, one
 * tap from every screen. A 360 px panel at ≥1024, a sheet on the phone. Items
 * land on their exact card. "Seen" is per browser (localStorage, best-effort);
 * the app badge mirrors the unseen count where supported. No OS notification
 * and no sound (quiet hours, Shabbat and the daily cap are H-05).
 */
export function Bell({ className, activity = false }: { className?: string; /** Finance roles: "מה קרה" (the activity log, which carries ₪) moves here from the home (I1). */ activity?: boolean }) {
  const t = useT(nav);
  const to = useT(overview);
  const locale = useLocale();
  const desk = useMediaQuery('(min-width: 1024px)', true);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const trigger = useRef<HTMLButtonElement>(null);
  const q = trpc.tasks.mine.useQuery(undefined, { staleTime: 30_000, refetchInterval: 120_000, refetchOnWindowFocus: true, retry: 1 });
  const tasks: Task[] = useMemo(() => q.data?.tasks ?? [], [q.data]);
  const feed = trpc.activity.feed.useQuery({ limit: 8 }, { enabled: activity && open, staleTime: 30_000 });

  useEffect(() => setSeen(readSeen(storage())), []);
  const unseen = unseenCount(tasks, seen);

  useEffect(() => {
    const n = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    try {
      if (unseen > 0) void n.setAppBadge?.(unseen)?.catch(() => undefined);
      else void n.clearAppBadge?.()?.catch(() => undefined);
    } catch {
      /* unsupported */
    }
  }, [unseen]);

  const close = useCallback(() => {
    setOpen(false);
    // Opening marked them seen; the trigger gets focus back (DoD-3).
    requestAnimationFrame(() => trigger.current?.focus());
  }, []);

  function toggle() {
    if (open) return close();
    setOpen(true);
    void q.refetch();
    const next = new Set([...seen, ...tasks.map(taskSig)]);
    setSeen(next);
    writeSeen(storage(), next);
  }

  const label = unseen > 0 ? `${t('bell.label')}, ${t('bell.unseen', { count: cappedCount(unseen, locale) })}` : t('bell.label');
  const body = <BellBody tasks={tasks} state={q.isError ? 'error' : q.isPending ? 'loading' : 'ok'} onRetry={() => void q.refetch()} onNavigate={() => setOpen(false)} />;

  return (
    <div className={cn('relative', className)} data-testid="bell">
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        data-testid="bell-trigger"
        // The reference's top-bar icon (.rm-ico): 36 px (44 on a phone), 8 px corners, an 18 px glyph, --sunken on hover.
        className="relative inline-flex size-9 items-center justify-center rounded-control text-fg-secondary hover:bg-surface-sunken hover:text-fg [@media(pointer:coarse)]:size-11"
      >
        <Icon as={BellIcon} size="bar" />
        {unseen > 0 ? (
          // An 8 px ink dot, never a count (the reference's .cnt-dot); the number stays in the trigger's name.
          <span
            aria-hidden="true"
            data-testid="bell-dot"
            className="absolute end-[7px] top-[7px] size-2 rounded-full bg-fg ring-2 ring-surface forced-color-adjust-none [@media(pointer:coarse)]:end-[11px] [@media(pointer:coarse)]:top-[11px]"
          />
        ) : null}
      </button>
      {desk ? (
        <BellPanel open={open} onClose={close} title={t('bell.title')} closeLabel={t('bell.close')}>
          {body}
        </BellPanel>
      ) : (
        <Sheet open={open} onClose={close} title={t('bell.title')}>
          <div data-testid="bell-panel">{body}</div>
        </Sheet>
      )}
    </div>
  );

  function BellBody({ tasks, state, onRetry, onNavigate }: { tasks: Task[]; state: 'ok' | 'error' | 'loading'; onRetry: () => void; onNavigate: () => void }) {
    const side = (agorot: number) => formatIls(agorot / 100, { locale });
    const rows = tasks.filter((x) => x.scope === 'mine').map((x) => taskRow(x, to, locale, side)).filter((r): r is TaskRow => r !== null);
    const others = othersLine(tasks, to, locale, side);
    if (state === 'error') {
      return (
        <p role="alert" className="flex items-center justify-between gap-2 text-sm text-ink">
          {t('bell.failed')}
          <button type="button" onClick={onRetry} className={cn('min-h-11 rounded-lg px-3 font-semibold text-primary')}>
            {t('bell.retry')}
          </button>
        </p>
      );
    }
    if (state === 'loading') return <p className="min-h-11 text-sm text-muted" aria-busy="true">…</p>;
    return (
      <div className="space-y-2">
        {rows.length === 0 ? <p className="text-sm font-semibold text-primary" data-testid="bell-empty">{others ?? t('bell.empty')}</p> : null}
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.key}>
              <Link
                href={r.href}
                onClick={onNavigate}
                data-testid={`bell-item-${r.type}`}
                className={cn('flex min-h-14 items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2 hover:border-primary/40')}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{r.label}</span>
                  {r.sub ? <span className="block truncate text-xs text-muted">{r.sub}</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-sm font-bold tabular-nums text-ink">
                  {r.agorot !== null ? <Money agorot={r.agorot} context="inline" decimals={r.decimals} /> : r.countText}
                  <ArrowLeft className="h-4 w-4 text-muted ltr:-scale-x-100" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {rows.length > 0 && others ? <p className="text-xs text-muted">{others}</p> : null}
        {activity && feed.data && feed.data.length > 0 ? (
          <section aria-labelledby="bell-activity-title" data-testid="bell-activity" className="border-t border-line pt-3">
            <h3 id="bell-activity-title" className="mb-2 text-sm font-bold text-ink">
              {t('bell.activity')}
            </h3>
            <ActivityFeed items={feed.data} />
          </section>
        ) : null}
      </div>
    );
  }
}

/** Desktop panel: a native modal <dialog> (focus trapped inside, returned on close), 360 px under the bell. */
function BellPanel({ open, onClose, title, closeLabel, children }: { open: boolean; onClose: () => void; title: string; closeLabel: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  // One bell per page: a constant id, independent of the tree position (train-C B6).
  const titleId = 'rm-bell-panel-title';
  useEffect(() => {
    const d = ref.current;
    if (!d || typeof d.showModal !== 'function') return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-testid="bell-panel"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed end-4 start-auto top-16 m-0 w-[360px] max-w-[calc(100vw-2rem)] rounded-overlay bg-surface p-4 text-ink shadow-e2 ring-1 ring-line-rule backdrop:bg-transparent"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id={titleId} className="text-base font-bold">
          {title}
        </h2>
        <button type="button" onClick={onClose} aria-label={closeLabel} className={cn('inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-surface-hover')}>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
