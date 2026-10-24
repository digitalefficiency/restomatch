'use client';

import { useEffect } from 'react';
import { marketing } from '@/lib/i18n/messages/marketing';

/** The root layout's cookie banner (lib/components/CookieConsent), found by its
 *  dialog label in either language — the dashboard does not own that component. */
const BANNER_SELECTOR = [marketing.he.cookie.label, marketing.en.cookie.label]
  .map((label) => `[role="dialog"][aria-label="${label}"]`)
  .join(',');

/** Height of the banner while it is actually shown (0 when absent / not yet shown). */
export function consentBannerHeight(el: Element | null): number {
  if (!(el instanceof HTMLElement)) return 0;
  if (el.classList.contains('invisible') || el.getAttribute('aria-hidden') === 'true') return 0;
  return el.offsetHeight;
}

/**
 * Keeps the dashboard's fixed chrome clear of the cookie-consent banner.
 *
 * Until the visitor answers it, the banner is fixed to the bottom of the
 * viewport — on a phone exactly where the bottom nav and the receiving wizard's
 * sticky "close receipt" CTA live, so a receiver on a fresh phone had to dismiss
 * it before they could navigate. This publishes the banner's height as
 * `--consent-h` on <html> while it is shown (0 after a choice); the bottom nav,
 * the page's bottom padding and the wizard footer sit that much higher, so the
 * banner and everything above it stay clickable.
 */
export function ConsentClearance() {
  useEffect(() => {
    const root = document.documentElement;
    let banner: Element | null = null;
    const resize = new ResizeObserver(() => publish());

    function publish() {
      root.style.setProperty('--consent-h', `${consentBannerHeight(banner)}px`);
    }
    function track() {
      const next = document.querySelector(BANNER_SELECTOR);
      if (next !== banner) {
        if (banner) resize.unobserve(banner);
        banner = next;
        if (banner) resize.observe(banner);
      }
      publish();
    }

    // The banner mounts after hydration and unmounts on a choice; its
    // visibility can also flip via class/aria-hidden. Batched per frame — the
    // dashboard toggles classes elsewhere too.
    let frame = 0;
    const mutations = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        track();
      });
    });
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'aria-hidden'],
    });
    track();
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      root.style.removeProperty('--consent-h');
    };
  }, []);
  return null;
}
