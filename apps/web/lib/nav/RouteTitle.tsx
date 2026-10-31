'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n/client';
import { nav } from '@/lib/i18n/messages/nav';
import { matchRoute } from './registry';
import { TITLE_SUFFIX, titleFor } from './titles';
import { useNavViewer } from './NavProvider';

/**
 * Keeps `document.title` = "<label> · <branch> — RestoMatch" on every
 * dashboard route. A changing title is also what makes Next's route announcer
 * speak on client navigations (it announces only when the title changes).
 * A page that sets its own specific title (an invoice number) keeps it.
 */
export function RouteTitle() {
  const pathname = usePathname();
  const viewer = useNavViewer();
  const t = useT(nav) as unknown as (key: string) => string;
  const def = matchRoute(pathname);
  const title = def ? titleFor(t(`links.${def.key}`), viewer?.branch) : null;
  useEffect(() => {
    if (!title) return;
    // Next's metadata may re-commit the root default ("RestoMatch") after us;
    // re-assert ours then, but leave a page's own specific title alone.
    const apply = () => {
      const current = document.title;
      if (current !== title && (current === TITLE_SUFFIX || current === '' || current.endsWith(` — ${TITLE_SUFFIX}`))) {
        document.title = title;
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
  return null;
}
