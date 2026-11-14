'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LinkButton } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { common } from '@/lib/i18n/messages/common';
import { settings } from '@/lib/i18n/messages/settings';
import { labelForRole } from '@/lib/roles';
import { LEGACY_HASHES, RESTAURANT_ROLES, SETTINGS_BASE } from '../_index/sections';

/**
 * The one-page settings screen had anchors (`/dashboard/settings#letterhead`,
 * used by the credit-letters page). Each now has its own section (`?s=`): send
 * the old anchor there, keeping the browser history clean.
 */
export function LegacyHashRedirect() {
  const router = useRouter();
  const section = useSearchParams()?.get('s') ?? null;
  useEffect(() => {
    // Only the old one-page address (no section in it): new links carry `?s=` and their own anchors.
    if (section) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    const to = id ? LEGACY_HASHES[id] : undefined;
    if (to) router.replace(to);
  }, [router, section]);
  return null;
}

/**
 * A restaurant section opened by a role that does not see it (receiver, chef):
 * calm, with the way back. The shell's own 403 wording (common:shell.forbidden),
 * with the section's name and the roles it is open to.
 */
export function SectionForbidden({ screen }: { screen: string }) {
  const t = useT(settings);
  const tc = useT(common);
  const locale = useLocale();
  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-e1">
      <h2 className="mb-2 text-title-sm text-ink">{tc('shell.forbidden.title', { screen })}</h2>
      <p className="mb-4 text-body-sm text-muted">
        {tc('shell.forbidden.allowed', { roles: RESTAURANT_ROLES.map((r) => labelForRole(r, locale)).join(', ') })}
      </p>
      <LinkButton href={SETTINGS_BASE} variant="secondary">
        {t('frame.backCta')}
      </LinkButton>
    </div>
  );
}
