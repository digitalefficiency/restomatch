'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Check, ChevronDown, FlaskConical, Receipt, X } from 'lucide-react';
import { LocaleSwitcher } from '@/lib/i18n/LocaleSwitcher';
import { cn } from '@/lib/components/cn';

export type DemoLink = { href: string; label: string };

/** The demo a path belongs to: the longest matching demo href (invoices beats dashboard). */
export function activeDemo(pathname: string, demos: DemoLink[]): DemoLink | null {
  let best: DemoLink | null = null;
  for (const d of demos) {
    if (pathname === d.href || pathname.startsWith(`${d.href}/`)) {
      if (!best || d.href.length > best.href.length) best = d;
    }
  }
  return best;
}

/**
 * Showcase chrome, one row ≤64 px on every width (W1-12 · mkt-16).
 *
 * - ≥xl: the five demos as tabs with an underlined active tab (`aria-current="page"`).
 * - <xl: a pill naming the current demo opens a bottom sheet listing all five
 *   (active one marked, `aria-current`), plus the way back to the site.
 * - The "demo · illustrative data" badge opens a small popover with the note
 *   that used to take a second header row.
 * - Primary CTA (same label and destination as the marketing site) + language.
 */
export function ShowcaseHeader({
  demos,
  cta,
  labels,
}: {
  demos: DemoLink[];
  cta: { href: string; label: string; short: string };
  labels: {
    brandTag: string;
    nav: string;
    pickDemo: string;
    pickDemoTitle: string;
    closePicker: string;
    badge: string;
    note: string;
    aboutDemo: string;
    backToSite: string;
  };
}) {
  const pathname = usePathname();
  const current = activeDemo(pathname, demos);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pickerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    setSheetOpen(false);
    setNoteOpen(false);
  }, [pathname]);

  const closeSheet = useCallback((returnFocus: boolean) => {
    setSheetOpen(false);
    if (returnFocus) requestAnimationFrame(() => pickerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!sheetOpen) return;
    const panel = sheetRef.current;
    const focusables = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>('a[href], button') ?? []);
    (panel?.querySelector<HTMLElement>('[aria-current="page"]') ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSheet(true);
      } else if (e.key === 'Tab') {
        const list = focusables();
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [sheetOpen, closeSheet]);

  // The note popover closes on Esc or a tap anywhere else.
  useEffect(() => {
    if (!noteOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setNoteOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!noteRef.current?.contains(e.target as Node)) setNoteOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [noteOpen]);

  const focus = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

  return (
    <>
      <header className="glass sticky top-0 z-40 border-b border-line">
        <div className="mx-auto flex h-[60px] max-w-7xl items-center gap-1.5 px-3 sm:gap-3 sm:px-6">
          <Link
            href="/showcase"
            className={cn('flex shrink-0 items-center gap-2 rounded-lg', focus)}
            aria-label={`RestoMatch — ${labels.brandTag}`}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-on-primary">
              <Receipt className="h-4 w-4" aria-hidden="true" />
            </span>
            <span
              className="hidden text-lg font-bold tracking-tight text-ink sm:inline"
              lang="en"
              dir="ltr"
            >
              RestoMatch
            </span>
          </Link>

          <div ref={noteRef} className="relative shrink-0">
            <button
              type="button"
              aria-expanded={noteOpen}
              aria-controls="showcase-demo-note"
              onClick={() => setNoteOpen((o) => !o)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border border-warn/40 bg-warn/10 px-2.5 py-1 text-xs font-semibold text-ink',
                focus,
              )}
            >
              <FlaskConical className="h-3.5 w-3.5 text-warn" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">{labels.badge}</span>
              <span className="sr-only">— {labels.aboutDemo}</span>
            </button>
            <div
              id="showcase-demo-note"
              role="note"
              hidden={!noteOpen}
              className="absolute start-0 top-full z-50 mt-2 w-72 rounded-xl border border-line bg-surface p-3 text-sm leading-relaxed text-ink shadow-card"
            >
              {labels.note}
            </div>
          </div>

          <nav aria-label={labels.nav} className="ms-2 hidden h-full items-stretch xl:flex">
            {demos.map((d) => {
              const active = current?.href === d.href;
              return (
                <Link
                  key={d.href}
                  href={d.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center border-b-2 px-3 text-sm font-medium transition-colors',
                    active
                      ? 'border-primary text-ink'
                      : 'border-transparent text-muted hover:text-ink',
                    focus,
                  )}
                >
                  {d.label}
                </Link>
              );
            })}
          </nav>

          <button
            ref={pickerRef}
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            aria-label={current ? `${labels.pickDemo}: ${current.label}` : labels.pickDemo}
            data-testid="demo-picker"
            className={cn(
              'inline-flex min-w-0 items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-semibold xl:hidden',
              current
                ? 'border-primary/40 bg-primary/10 text-ink'
                : 'border-line bg-surface-2 text-ink',
              focus,
            )}
          >
            <span className="truncate">{current ? current.label : labels.pickDemo}</span>
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
          </button>

          <div className="ms-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <Link
              href="/"
              className={cn(
                'hidden items-center gap-1 rounded-lg px-2.5 py-2 text-sm font-medium text-muted hover:text-primary lg:inline-flex',
                focus,
              )}
            >
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
              {labels.backToSite}
            </Link>
            <Link
              href={cta.href}
              className={cn(
                'inline-flex min-h-10 [@media(pointer:coarse)]:min-h-11 items-center rounded-full bg-primary px-3 text-sm font-semibold text-on-primary hover:brightness-110 sm:px-4',
                focus,
              )}
            >
              <span className="sm:hidden">{cta.short}</span>
              <span className="hidden sm:inline">{cta.label}</span>
            </Link>
            <LocaleSwitcher />
          </div>
        </div>
      </header>

      {mounted && sheetOpen
        ? createPortal(
            <div className="fixed inset-0 z-[70] xl:hidden">
              <div
                className="absolute inset-0 bg-ink/40"
                aria-hidden="true"
                onClick={() => closeSheet(true)}
              />
              <div
                ref={sheetRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="showcase-picker-title"
                data-testid="demo-sheet"
                className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-card"
              >
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" aria-hidden="true" />
                <div className="mb-2 flex items-center justify-between">
                  <h2 id="showcase-picker-title" className="text-base font-bold text-ink">
                    {labels.pickDemoTitle}
                  </h2>
                  <button
                    type="button"
                    onClick={() => closeSheet(true)}
                    aria-label={labels.closePicker}
                    className={cn(
                      'flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-surface-2',
                      focus,
                    )}
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
                <nav aria-label={labels.nav}>
                  <ul className="flex flex-col gap-1">
                    {demos.map((d) => {
                      const active = current?.href === d.href;
                      return (
                        <li key={d.href}>
                          <Link
                            href={d.href}
                            aria-current={active ? 'page' : undefined}
                            onClick={() => closeSheet(false)}
                            className={cn(
                              'flex min-h-12 items-center justify-between rounded-xl px-3 text-base font-medium',
                              active
                                ? 'bg-primary/10 text-ink ring-1 ring-primary/30'
                                : 'text-ink hover:bg-surface-2',
                              focus,
                            )}
                          >
                            {d.label}
                            {active ? (
                              <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                            ) : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
                <Link
                  href="/"
                  onClick={() => closeSheet(false)}
                  className={cn(
                    'mt-3 flex min-h-12 items-center gap-2 rounded-xl px-3 text-base font-medium text-muted hover:bg-surface-2',
                    focus,
                  )}
                >
                  <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                  {labels.backToSite}
                </Link>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
