'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Minimize2, RefreshCw } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDateTime } from '@/lib/i18n/format';
import { views } from '@/lib/i18n/messages/views';

const REFRESH_MS = 60_000;

/**
 * Full-screen "TV on the office wall" mode (`?tv=1`): the view fills the
 * screen above the dashboard chrome and re-renders on the server every minute
 * (router.refresh keeps the URL and scroll). Esc or the exit button leaves it.
 * When inactive it renders its children untouched.
 */
export function TvMode({ active, children }: { active: boolean; children: React.ReactNode }) {
  const t = useT(views);
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [updated, setUpdated] = useState<Date | null>(null);

  const exit = useCallback(() => {
    const sp = new URLSearchParams(window.location.search);
    sp.delete('tv');
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
    } catch {
      /* fullscreen API unavailable */
    }
    const q = sp.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [pathname, router]);

  useEffect(() => {
    if (!active) return;
    setUpdated(new Date());
    const id = window.setInterval(() => {
      router.refresh();
      setUpdated(new Date());
    }, REFRESH_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exit();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('keydown', onKey);
    };
  }, [active, exit, router]);

  if (!active) return <>{children}</>;

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-bg px-4 py-5 sm:px-8 sm:py-8" data-tv-mode="">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-xs text-subtle">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {t('tv.refresh')}
            {updated ? <> · {t('tv.updated', { time: formatDateTime(updated, locale, { timeStyle: 'short' }) })}</> : null}
          </p>
          <button
            type="button"
            onClick={exit}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-sm font-semibold text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <Minimize2 className="h-4 w-4" aria-hidden="true" />
            {t('tv.exit')}
          </button>
        </div>
        <div className="text-[1.05rem]">{children}</div>
      </div>
    </div>
  );
}
