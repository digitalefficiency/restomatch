'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MessageCircle } from 'lucide-react';

/** Below this scroll depth a page without a hero anchor keeps the bar hidden. */
const FALLBACK_SCROLL_PX = 480;

/**
 * Phone-only sticky CTA bar (W1-12 · mkt-05).
 *
 * - Appears once the hero CTA (`[data-sticky-cta-anchor]`) has scrolled out of
 *   view; on pages without one, after the first screenful.
 * - Hides while the lead form (`#lead`) or the site footer is on screen, so it
 *   never doubles the form's own button or covers the footer links.
 * - Sits above the cookie banner (`--consent-h`) and the safe area, and
 *   publishes its height as `--rm-bottomnav-h` while shown.
 * - [WhatsApp] (outline, only when configured) + [primary CTA] (solid), ≥48 px each.
 */
export function StickyCta({
  cta,
  whatsapp,
  label,
}: {
  cta: { href: string; label: string };
  whatsapp: { href: string; label: string } | null;
  label: string;
}) {
  const [show, setShow] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let pastAnchor = false;
    const onScreen = new Set<Element>();
    const update = () => setShow(pastAnchor && onScreen.size === 0);

    const anchor = document.querySelector('[data-sticky-cta-anchor]');
    let anchorIo: IntersectionObserver | null = null;
    const onScroll = () => {
      pastAnchor = window.scrollY > FALLBACK_SCROLL_PX;
      update();
    };
    if (anchor) {
      anchorIo = new IntersectionObserver(([e]) => {
        if (!e) return;
        // Past = scrolled above the viewport (not merely below the fold).
        pastAnchor = !e.isIntersecting && e.boundingClientRect.bottom < 0;
        update();
      });
      anchorIo.observe(anchor);
    } else {
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }

    const blockers = document.querySelectorAll('#lead, [data-site-footer]');
    const blockIo = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) onScreen.add(e.target);
        else onScreen.delete(e.target);
      }
      update();
    });
    blockers.forEach((b) => blockIo.observe(b));

    return () => {
      anchorIo?.disconnect();
      blockIo.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Publish the bar height for scroll-padding / toasts while it is shown.
  useEffect(() => {
    const root = document.documentElement;
    if (show && barRef.current) {
      root.style.setProperty('--rm-bottomnav-h', `${barRef.current.offsetHeight}px`);
    } else {
      root.style.removeProperty('--rm-bottomnav-h');
    }
    return () => {
      root.style.removeProperty('--rm-bottomnav-h');
    };
  }, [show]);

  return (
    <div
      ref={barRef}
      role="region"
      aria-label={label}
      hidden={!show}
      data-testid="sticky-cta"
      className="fixed inset-x-0 z-40 border-t border-line bg-surface/95 px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-card backdrop-blur md:hidden"
      style={{ bottom: 'var(--consent-h, 0px)' }}
    >
      <div className="mx-auto flex max-w-md gap-2">
        {whatsapp ? (
          <a
            href={whatsapp.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            {whatsapp.label}
          </a>
        ) : null}
        <Link
          href={cta.href}
          className="flex min-h-12 flex-[2] items-center justify-center rounded-xl bg-primary px-4 text-base font-semibold text-on-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {cta.label}
        </Link>
      </div>
    </div>
  );
}
