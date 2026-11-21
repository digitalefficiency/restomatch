'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, MoreHorizontal, Search, ShieldCheck, X } from 'lucide-react';
import { cn } from '@/lib/components/cn';
import { useNavBadges } from '@/lib/components/notifications';
import { useLocale, useT } from '@/lib/i18n/client';
import { nav } from '@/lib/i18n/messages/nav';
import type { NavViewer } from '../types';
import { activeNavKey, barItems, isFieldPath, moreGroups } from '../visibility';
import { badgeLook, type BadgeValueLike } from '../badgeLook';
import { isViewOnly } from '../viewOnly';
import { inSpecOrder } from '../shellModel';
import { SUPPORT_LINKS } from '../support';
import { DOT_CLASS, NavIcon, Pill, badgeWordsFor, iconProps } from './NavItem';
import { useShellUi } from './ShellFrame';

const focusRing =
  'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus';
const FIELD_ROLES = new Set(['chef', 'receiver']);

/** On-screen keyboard heuristic: the visual viewport shrank by more than 150 px. */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let max = vv.height;
    let width = vv.width;
    const onResize = () => {
      if (Math.abs(vv.width - width) > 1) {
        // Rotation: start a new baseline.
        width = vv.width;
        max = vv.height;
      }
      max = Math.max(max, vv.height);
      setOpen(max - vv.height > 150);
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);
  return open;
}

function useBadgeWords() {
  const t = useT(nav) as unknown as (key: string, vars?: Record<string, string>) => string;
  return useMemo(
    () => ({
      items: (count: string) => t('badge.items', { count }),
      atRisk: (amount: string) => t('badge.atRisk', { amount }),
      owed: (amount: string) => t('badge.owed', { amount }),
      blocking: t('badge.blocking'),
    }),
    [t],
  );
}

/**
 * Phone bottom bar (< 1024, sidebar spec §11): the role's four registry slots +
 * "עוד", 64 px + the safe area, 12 px labels that never truncate. Hidden on field
 * routes and while the on-screen keyboard is open; the shell publishes
 * `--rm-bottomnav-h` accordingly. A slot's badge is a dot with a cut-out ring.
 */
export function BottomBar({ viewer }: { viewer: NavViewer }) {
  const badges = useNavBadges();
  const t = useT(nav) as unknown as (key: string) => string;
  const locale = useLocale();
  const words = useBadgeWords();
  const pathname = usePathname();
  const { moreOpen, openMore } = useShellUi();
  const keyboard = useKeyboardOpen();
  const hidden = isFieldPath(pathname) || keyboard;
  const activeKey = activeNavKey(pathname);
  const items = barItems(viewer);
  const inBar = items.some((b) => b.def.key === activeKey);
  const fieldRole = FIELD_ROLES.has(viewer.role);

  useEffect(() => {
    document.documentElement.dataset.rmBar = hidden ? 'off' : 'on';
    return () => {
      delete document.documentElement.dataset.rmBar;
    };
  }, [hidden]);

  const slot = 'flex flex-1 flex-col items-center justify-center gap-1 px-0.5 text-xs leading-4';
  // 56 × 32, as the bar has been since W1-03 (and as its spec pins).
  const pill = 'relative inline-flex h-8 w-14 items-center justify-center rounded-pill transition-colors duration-micro';

  return (
    <nav
      aria-label={t('mobileLabel')}
      hidden={hidden}
      data-testid="bottom-bar"
      // Lifted above the cookie banner while it is shown (ConsentClearance).
      className="fixed inset-x-0 bottom-[var(--consent-h,0px)] z-bottom-bar border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto flex h-16 max-w-lg items-stretch">
        {items.map(({ def, label }) => {
          const active = def.key === activeKey;
          const value = badges[def.key] as BadgeValueLike | undefined;
          // A view-only row carries no badge (§4.1).
          const look = isViewOnly(viewer.role, def.key) ? null : badgeLook(value, { fieldRole });
          const { icon, k, mirrored } = iconProps(def.key);
          const bw = badgeWordsFor(look ? value : undefined, locale, words);
          return (
            <li key={def.key} className="flex min-w-0 flex-1">
              <Link
                href={def.path}
                aria-current={active ? 'page' : undefined}
                className={cn(slot, focusRing, active ? 'font-semibold text-ink' : 'font-medium text-muted hover:text-ink')}
              >
                <span className={cn(pill, active && 'bg-primary-subtle text-primary')}>
                  <span className="relative inline-flex h-6 w-6 items-center justify-center [&>svg]:h-6 [&>svg]:w-6">
                    <NavIcon icon={icon} k={k} mirrored={mirrored} />
                    {look ? (
                      <span
                        aria-hidden="true"
                        data-badge-dot={look.railDot === 'danger' ? 'block' : 'on'}
                        className={cn('absolute -end-[3px] -top-[3px] h-2 w-2 rounded-full ring-2 ring-surface', DOT_CLASS[look.railDot])}
                      />
                    ) : null}
                  </span>
                </span>
                <span data-bar-label="" className="max-w-full whitespace-nowrap">
                  {t(`bar.${label}`)}
                </span>
                {/* The badge's meaning inside the link, visually hidden (sidebar spec §9). */}
                {bw ? <span className="sr-only">, {bw}</span> : null}
              </Link>
            </li>
          );
        })}
        <li className="flex min-w-0 flex-1">
          <button
            type="button"
            onClick={(e) => openMore(e.currentTarget)}
            aria-expanded={moreOpen}
            aria-controls="dashboard-drawer"
            aria-haspopup="dialog"
            className={cn(
              slot,
              'w-full',
              focusRing,
              // Pages that live in "עוד" light it up, so the bar always shows where you are.
              !inBar && activeKey ? 'font-semibold text-ink' : 'font-medium text-muted hover:text-ink',
            )}
          >
            <span className={cn(pill, !inBar && activeKey && 'bg-primary-subtle text-primary')}>
              <MoreHorizontal aria-hidden="true" width={24} height={24} strokeWidth={1.75} />
            </span>
            <span data-bar-label="" className="whitespace-nowrap">
              {t('bar.more')}
            </span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

/**
 * The "עוד" bottom sheet (sidebar spec §11): a native modal <dialog> — search
 * (the palette), the branch list, every item not in the bar grouped like the
 * desktop menu in 48 px rows, then who is signed in, language, help and
 * sign-out, with a 44 × 44 close. Esc closes, focus returns to "עוד"; Tab
 * wraps inside it; navigating from it hands focus to the new page's h1.
 */
export function MoreSheet({
  viewer,
  branchList,
  language,
  logout,
  email,
  isPlatformAdmin,
}: {
  viewer: NavViewer;
  /** The branch switcher (list variant) for users with ≥ 2 memberships. */
  branchList?: React.ReactNode;
  /** The language control (picker or עב/EN toggle). */
  language: React.ReactNode;
  logout: () => Promise<void>;
  email: string;
  isPlatformAdmin: boolean;
}) {
  const badges = useNavBadges();
  const t = useT(nav) as unknown as (key: string) => string;
  const locale = useLocale();
  const words = useBadgeWords();
  const pathname = usePathname();
  const ui = useShellUi();
  const { moreOpen, closeMore } = ui;
  const ref = useRef<HTMLDialogElement>(null);
  const activeKey = activeNavKey(pathname);
  const groups = moreGroups(viewer);
  const titleId = 'dashboard-drawer-title';
  const fieldRole = FIELD_ROLES.has(viewer.role);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (moreOpen && !d.open) {
      d.showModal();
      d.querySelector<HTMLElement>('[data-sheet-close]')?.focus();
    } else if (!moreOpen && d.open) d.close();
  }, [moreOpen]);

  // While it is open the page behind is inert (the native modal makes it so; the attribute keeps
  // older engines and our own Tab-wrap check honest).
  useEffect(() => {
    if (!moreOpen) return;
    const app = document.getElementById('rm-app');
    app?.setAttribute('inert', '');
    return () => app?.removeAttribute('inert');
  }, [moreOpen]);

  // Close on navigation: the new page's h1 takes focus.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current !== pathname && moreOpen) closeMore({ restoreFocus: false });
    lastPath.current = pathname;
  }, [pathname, moreOpen, closeMore]);

  // Rotating a tablet past 1024 px hides the sheet: close it, or the app would stay inert.
  useEffect(() => {
    if (!moreOpen) return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => {
      if (mq.matches) closeMore({ restoreFocus: false });
    };
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [moreOpen, closeMore]);

  // Tab and Shift+Tab wrap inside the sheet (never out to the browser chrome).
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== 'Tab') return;
    const root = ref.current;
    if (!root) return;
    const list = [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
      (el) => el.getClientRects().length > 0 && !el.closest('[hidden]'),
    );
    if (!list.length) return;
    const first = list[0]!;
    const last = list[list.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  return (
    <dialog
      ref={ref}
      id="dashboard-drawer"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        // An inner control that handled Esc itself (the language menu) keeps the sheet open.
        e.preventDefault();
        closeMore();
      }}
      onClose={() => {
        if (moreOpen) closeMore();
      }}
      onClick={(e) => {
        if (e.target === ref.current) closeMore();
      }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 mt-auto max-h-[85vh] w-full max-w-none flex-col rounded-t-overlay border-t border-line bg-surface p-0 pb-[env(safe-area-inset-bottom)] text-ink shadow-e3 backdrop:bg-ink/40 open:flex lg:hidden"
    >
      {moreOpen ? (
        <>
          <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-pill bg-line-strong" />
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            <h2 id={titleId} className="text-base font-bold leading-6 text-ink">
              {t('bar.more')}
            </h2>
            <button
              type="button"
              data-sheet-close=""
              onClick={() => closeMore()}
              aria-label={t('menu.close')}
              className={cn('inline-flex h-11 w-11 items-center justify-center rounded-control text-muted hover:text-ink', focusRing)}
            >
              <X aria-hidden="true" width={20} height={20} strokeWidth={1.75} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <button
              type="button"
              onClick={() => {
                closeMore();
                requestAnimationFrame(() => ui.openPalette());
              }}
              className={cn(
                'mb-4 flex min-h-12 w-full items-center gap-2 rounded-control border border-line-strong bg-surface px-3 text-start text-sm text-subtle',
                focusRing,
              )}
            >
              <Search aria-hidden="true" width={16} height={16} strokeWidth={1.75} />
              {t('shell.openSearch')}
            </button>
            {branchList ? <div className="mb-4 rounded-card border border-line py-2">{branchList}</div> : null}
            <nav aria-label={t('mainLabel')}>
              {groups.map((g) => (
                <section key={g.group} className="mb-4" aria-labelledby={`more-${g.group}`}>
                  <h3 id={`more-${g.group}`} className="mb-2 text-xs font-semibold leading-4 text-subtle">
                    {t(`groups.${g.group}`)}
                  </h3>
                  <ul className="grid grid-cols-2 gap-2">
                    {inSpecOrder(g.items).map((d) => {
                      const active = d.key === activeKey;
                      const value = badges[d.key] as BadgeValueLike | undefined;
                      const look = isViewOnly(viewer.role, d.key) ? null : badgeLook(value, { fieldRole });
                      const { icon, k, mirrored } = iconProps(d.key);
                      const bw = badgeWordsFor(look ? value : undefined, locale, words);
                      return (
                        <li key={d.key}>
                          <Link
                            href={d.path}
                            aria-current={active ? 'page' : undefined}
                            className={cn(
                              'flex min-h-12 items-center gap-2.5 rounded-control border px-3 py-2 text-sm leading-5',
                              focusRing,
                              active
                                ? 'border-primary-border-subtle bg-primary-subtle font-semibold text-ink'
                                : 'border-line text-ink hover:bg-surface-2',
                            )}
                          >
                            <span className={cn('inline-flex shrink-0 [&>svg]:h-5 [&>svg]:w-5', active ? 'text-primary' : 'text-muted')}>
                              <NavIcon icon={icon} k={k} mirrored={mirrored} />
                            </span>
                            <span className="min-w-0 flex-1 break-words">{t(`links.${d.key}`)}</span>
                            {bw ? <span className="sr-only">, {bw}</span> : null}
                            {look ? <Pill look={look} tone={value?.tone ?? 'neutral'} locale={locale} /> : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </nav>
            <section aria-labelledby="more-profile" className="border-t border-line pt-4">
              <h3 id="more-profile" className="mb-2 text-xs font-semibold leading-4 text-subtle">
                {t('shell.profile')}
              </h3>
              <p className="mb-3 truncate text-sm text-muted">
                <bdi>{email}</bdi>
              </p>
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-sm text-ink">{t('shell.language')}</span>
                {language}
              </div>
              <ul aria-label={t('shell.support')} data-testid="support-links-sheet" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
                {SUPPORT_LINKS.map((l) => (
                  <li key={l.key}>
                    <Link
                      href={l.href}
                      prefetch={false}
                      className={cn('inline-flex min-h-11 min-w-11 items-center justify-center rounded-xs px-1 hover:text-ink hover:underline', focusRing)}
                    >
                      {t(`shell.${l.key}`)}
                    </Link>
                  </li>
                ))}
              </ul>
              {isPlatformAdmin ? (
                <Link
                  href="/admin"
                  className={cn('mt-3 flex min-h-12 items-center gap-2 rounded-control px-3 text-sm text-ink hover:bg-surface-2', focusRing)}
                >
                  <ShieldCheck aria-hidden="true" width={16} height={16} strokeWidth={1.75} className="text-muted" />
                  {t('shell.platformAdmin')}
                </Link>
              ) : null}
              <form action={logout} data-rm-logout="" className="mt-3">
                <button
                  type="submit"
                  className={cn(
                    'flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-line text-sm font-semibold text-ink hover:bg-surface-2',
                    focusRing,
                  )}
                >
                  <LogOut aria-hidden="true" width={16} height={16} strokeWidth={1.75} className="rtl:-scale-x-100" />
                  {t('signOut')}
                </button>
              </form>
            </section>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
