'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, MessageCircle, X } from 'lucide-react';

export type MenuLink = { href: string; label: string };

/**
 * Phone/tablet navigation sheet (W1-12 · mkt-08). Replaces the native
 * <details> menu, which stayed open after a link, an outside tap or Esc.
 *
 * - The trigger is a 44 px button with `aria-expanded`/`aria-controls`.
 * - The sheet slides in from the start edge over a scrim (portalled to <body>:
 *   the header's backdrop-filter would otherwise trap a fixed child).
 * - It closes on a link tap, a hash change, a route change, a scrim tap, the
 *   close button and Esc; Esc / scrim / close return focus to the trigger.
 * - Focus is kept inside while open; the page behind does not scroll.
 * - 48 px rows; the primary CTA (and WhatsApp when configured) are pinned at the bottom.
 */
export function MobileMenu({
  items,
  login,
  cta,
  whatsapp,
  labels,
}: {
  items: MenuLink[];
  login: MenuLink;
  cta: MenuLink;
  whatsapp: MenuLink | null;
  labels: { open: string; close: string; title: string; nav: string };
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const id = useId();
  const panelId = `mobile-menu-${id.replace(/:/g, '')}`;
  const titleId = `${panelId}-title`;

  useEffect(() => setMounted(true), []);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  // A route change (link to another page) closes the sheet.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const focusables = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const onHash = () => close(false);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onHash);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onHash);
    };
  }, [open, close]);

  const row =
    'flex min-h-12 items-center rounded-xl px-3 text-base font-medium text-ink transition-colors hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={labels.open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-surface-2 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
        data-testid="mobile-menu-trigger"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>
      {mounted && open
        ? createPortal(
            <div className="fixed inset-0 z-[70] lg:hidden" data-testid="mobile-menu">
              <div
                className="absolute inset-0 bg-ink/40"
                aria-hidden="true"
                onClick={() => close(true)}
                data-testid="mobile-menu-scrim"
              />
              <div
                ref={panelRef}
                id={panelId}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="absolute inset-y-0 start-0 flex w-[min(20rem,85vw)] flex-col bg-surface shadow-card"
              >
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <h2 id={titleId} className="text-base font-bold text-ink">
                    {labels.title}
                  </h2>
                  <button
                    type="button"
                    onClick={() => close(true)}
                    aria-label={labels.close}
                    className="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
                <nav aria-label={labels.nav} className="flex-1 overflow-y-auto p-2">
                  <ul className="flex flex-col gap-0.5">
                    {[...items, login].map((n) => (
                      <li key={n.href}>
                        <Link href={n.href} className={row} onClick={() => close(false)}>
                          {n.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
                <div className="flex flex-col gap-2 border-t border-line p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                  <Link
                    href={cta.href}
                    onClick={() => close(false)}
                    className="flex min-h-12 items-center justify-center rounded-xl bg-primary px-4 text-base font-semibold text-on-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    {cta.label}
                  </Link>
                  {whatsapp ? (
                    <a
                      href={whatsapp.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-base font-semibold text-ink hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <MessageCircle className="h-4 w-4" aria-hidden="true" />
                      {whatsapp.label}
                    </a>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
