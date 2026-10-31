'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import {
  ATTRIBUTION_STORAGE_KEY,
  attributionFromSearch,
  mergeAttribution,
  type Attribution as AttributionData,
} from './leadForm.logic';

/** Read the stored attribution for this visit (null when storage is blocked or empty). */
export function readAttribution(): AttributionData | null {
  try {
    const raw = window.sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AttributionData) : null;
  } catch {
    return null;
  }
}

/**
 * Captures UTM params, `?plan=` and the entry page into sessionStorage on every
 * public page view (W1-12 · mkt-28), so the lead form can send them as
 * `source`. Cookieless, first-party, cleared when the tab closes. Renders nothing.
 */
export function Attribution() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      const next = attributionFromSearch(window.location.search, pathname);
      const merged = mergeAttribution(readAttribution(), next);
      window.sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // Storage blocked (private mode, policy): attribution is best-effort.
    }
  }, [pathname]);
  return null;
}
