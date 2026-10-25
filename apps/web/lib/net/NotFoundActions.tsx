'use client';

import { usePathname } from 'next/navigation';
import { LinkButton } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { common } from '@/lib/i18n/messages/common';
import { detailParent } from './branchSafeTarget';
import { screenKeyForPath } from './access';

/** "Back to <parent list>" (from the URL that 404'd) + home. */
export function NotFoundActions() {
  const t = useT(common);
  const pathname = usePathname() ?? '/dashboard';
  const parent = detailParent(pathname);
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {parent ? (
        <LinkButton href={parent} variant="primary" className="min-h-[44px]" data-testid="not-found-up">
          {t('shell.notFound.up', { screen: t(`shell.screens.${screenKeyForPath(parent)}`) })}
        </LinkButton>
      ) : null}
      <LinkButton href="/dashboard" variant={parent ? 'secondary' : 'primary'} className="min-h-[44px]">
        {t('shell.notFound.home')}
      </LinkButton>
    </div>
  );
}
