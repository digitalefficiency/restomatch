'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import type { UserRole } from '@restomatch/db';
import { cn, useAnnounce } from '@/lib/components';
import { matchesHe } from '@/lib/components/palette/normalizeHe';
import { useT } from '@/lib/i18n/client';
import { settings } from '@/lib/i18n/messages/settings';
import { useIsCoarse, useIsNarrow, useIsPhone } from '@/lib/prefs';
import {
  activeSection,
  sectionById,
  sectionsFor,
  settingHref,
  settingsFor,
  type SectionId,
  type SettingsGroup,
} from '../_index/sections';

/* ───────────── unsaved changes: kept across sections, marked in the list ───────────── */

interface SessionApi {
  mark: (section: SectionId, dirty: boolean) => void;
  drafts: Map<SectionId, unknown>;
}
const SessionContext = createContext<SessionApi>({ mark: () => {}, drafts: new Map() });
const SessionProvider = SessionContext.Provider as unknown as React.ComponentType<{
  value: SessionApi;
  children: React.ReactNode;
}>;

/**
 * A form's unsaved draft, kept by the frame (the settings layout), so opening
 * another section or following a search result does not lose it; the section
 * list shows a dot on the section while a draft is kept, and a reload or a
 * closed tab asks first. `initial` is the kept draft (read it once, when the
 * form mounts); `keep(draft)` stores it, `keep(undefined)` drops it.
 */
export function useSectionDraft<T>(section: SectionId): {
  initial: T | undefined;
  keep: (draft: T | undefined) => void;
} {
  const api = useContext(SessionContext);
  const keep = useCallback(
    (draft: T | undefined) => {
      if (draft === undefined) api.drafts.delete(section);
      else api.drafts.set(section, draft);
      api.mark(section, draft !== undefined);
    },
    [api, section],
  );
  return { initial: api.drafts.get(section) as T | undefined, keep };
}

/** Highlight (and focus) the row a link pointed at, for a moment, after it arrives. */
function useArrivalHighlight() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? '';
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hit = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.querySelector<HTMLElement>(`[data-setting-row="${CSS.escape(id)}"]`);
      if (!el) return;
      el.scrollIntoView({ block: 'nearest' });
      el.focus({ preventScroll: true });
      el.dataset.hit = 'true';
      clearTimeout(timer);
      timer = setTimeout(() => {
        delete el.dataset.hit;
      }, 1600);
    };
    // After the section has rendered.
    const raf = requestAnimationFrame(hit);
    window.addEventListener('hashchange', hit);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('hashchange', hit);
      clearTimeout(timer);
    };
  }, [pathname, search]);
}

/**
 * The settings frame (SPEC §10.5, reference #ex4): the page title, a field that
 * finds any setting, the sections in two groups ("אני", "המסעדה") and the open
 * section beside them. On a phone the sections become a row of chips above the
 * open section and settings that do nothing there are not offered.
 */
export function SettingsFrame({
  role,
  children,
}: {
  role: UserRole | null;
  children: React.ReactNode;
}) {
  const t = useT(settings);
  const tt = t as unknown as (key: string, vars?: Record<string, string | number>) => string;
  const pathname = usePathname();
  const announce = useAnnounce();
  const coarse = useIsCoarse();
  const narrow = useIsNarrow();
  const phone = useIsPhone();
  const [query, setQuery] = useState('');
  const [dirty, setDirty] = useState<ReadonlySet<SectionId>>(() => new Set());
  const drafts = useRef(new Map<SectionId, unknown>());

  const mark = useCallback((section: SectionId, isDirty: boolean) => {
    setDirty((prev) => {
      if (prev.has(section) === isDirty) return prev;
      const next = new Set(prev);
      if (isDirty) next.add(section);
      else next.delete(section);
      return next;
    });
  }, []);
  const session = useMemo<SessionApi>(() => ({ mark, drafts: drafts.current }), [mark]);

  // Leave guard: a kept draft is lost on a reload or a closed tab.
  const anyDirty = dirty.size > 0;
  useEffect(() => {
    if (!anyDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [anyDirty]);

  useArrivalHighlight();

  const params = useSearchParams();
  const current = activeSection(pathname, params?.get('s') ?? null);
  // Say which section opened (the page title is the shell's and stays "הגדרות"); focus stays on the link clicked.
  const opened = useRef(current);
  useEffect(() => {
    if (opened.current === current) return;
    opened.current = current;
    announce(tt(sectionById(current).titleKey));
  }, [current, announce, tt]);
  const sections = sectionsFor(role);
  const groups = (['me', 'restaurant'] as SettingsGroup[])
    .map((g) => ({ g, items: sections.filter((s) => s.group === g) }))
    .filter((x) => x.items.length > 0);

  const q = query.trim();
  const results = useMemo(() => {
    if (!q) return null;
    return settingsFor(role, { coarse, narrow, phone }).filter((e) => {
      const section = sectionById(e.section);
      const hay = [
        tt(e.titleKey),
        tt(section.titleKey),
        e.keywordsKey ? tt(e.keywordsKey) : '',
      ].join(' ');
      return matchesHe(hay, q);
    });
  }, [q, role, coarse, narrow, phone, tt]);

  // One announcement once the typing rests (the list itself is not a live region: it would re-read every link).
  const resultCount = results?.length ?? null;
  useEffect(() => {
    if (resultCount === null) return;
    const id = setTimeout(() => announce(tt('frame.sr.results', { count: resultCount })), 500);
    return () => clearTimeout(id);
  }, [resultCount, q, announce, tt]);

  return (
    <SessionProvider value={session}>
      <h1 className="mb-6 text-title-lg text-ink">{t('title')}</h1>
      <div className="grid gap-6 lg:grid-cols-[theme(spacing.56)_minmax(0,1fr)] lg:gap-8">
        <nav aria-label={t('frame.sectionsAria')} className="min-w-0">
          <label className="mb-2 flex h-11 items-center gap-2 rounded-control bg-surface-2 px-2.5 text-subtle ring-1 ring-inset ring-line-strong focus-within:ring-2 focus-within:ring-focus lg:h-9">
            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="sr-only">{t('frame.searchAria')}</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.preventDefault();
                  setQuery('');
                }
              }}
              autoComplete="off"
              spellCheck={false}
              placeholder={t('frame.searchPlaceholder')}
              className="h-full min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-subtle lg:text-body-sm"
            />
          </label>

          {results ? (
            <div aria-label={t('frame.resultsAria')} role="region">
              {results.length === 0 ? (
                <p className="px-2.5 py-3 text-body-sm text-muted">{t('frame.noResults')}</p>
              ) : (
                <ul className="space-y-0.5">
                  {results.map((e) => (
                    <li key={e.id}>
                      <Link
                        href={settingHref(e)}
                        onClick={() => setQuery('')}
                        className="flex min-h-11 items-center gap-2 rounded-control px-2.5 text-body-sm font-medium text-muted transition-colors duration-micro hover:bg-surface-2 hover:text-ink lg:min-h-8"
                      >
                        <span className="min-w-0 flex-1 truncate">{tt(e.titleKey)}</span>
                        <span className="shrink-0 text-caption font-normal text-subtle">
                          {tt(sectionById(e.section).titleKey)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 lg:block lg:overflow-visible lg:pb-0">
              {groups.map(({ g, items }) => (
                <div key={g} className="contents lg:block">
                  <p className="hidden px-2.5 pb-1 pt-3.5 text-caption font-semibold text-subtle lg:block">
                    {t(`frame.groups.${g}` as 'frame.groups.me')}
                  </p>
                  <ul className="contents lg:block lg:space-y-0.5">
                    {items.map((s) => {
                      const isCurrent = s.id === current;
                      const unsaved = dirty.has(s.id);
                      return (
                        <li key={s.id} className="shrink-0 lg:shrink">
                          <Link
                            href={s.href}
                            aria-current={isCurrent ? 'page' : undefined}
                            className={cn(
                              'relative flex min-h-11 items-center gap-2 whitespace-nowrap rounded-pill px-3.5 text-body-sm font-medium ring-1 ring-inset ring-line-strong transition-colors duration-micro',
                              'lg:min-h-8 lg:rounded-control lg:px-2.5 lg:ring-0',
                              isCurrent
                                ? 'bg-ink text-on-bold lg:bg-surface-2 lg:font-semibold lg:text-ink lg:before:absolute lg:before:inset-y-2 lg:before:start-0 lg:before:w-0.5 lg:before:rounded-pill lg:before:bg-primary'
                                : 'text-muted hover:bg-surface-2 hover:text-ink',
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate">{tt(s.titleKey)}</span>
                            {unsaved ? (
                              <>
                                <span
                                  aria-hidden="true"
                                  className="size-2 shrink-0 rounded-pill bg-info forced-color-adjust-none"
                                />
                                <span className="sr-only">, {t('frame.unsavedSr')}</span>
                              </>
                            ) : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </nav>
        <div className="min-w-0" id="settings-section">
          {children}
        </div>
      </div>
    </SessionProvider>
  );
}
