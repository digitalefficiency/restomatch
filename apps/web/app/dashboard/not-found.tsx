import type { UserRole } from '@restomatch/db';
import { auth } from '@/auth';
import { getT } from '@/lib/i18n/server';
import { common } from '@/lib/i18n/messages/common';
import { Card } from '@/lib/components';
import { NotFoundActions } from '@/lib/net/NotFoundActions';

/**
 * In-shell 404 (W1-04, perf-states-09 / ia-nav-07): a `notFound()` anywhere
 * under /dashboard (bad id, flag off, another branch's record) renders here,
 * INSIDE the dashboard layout — header, nav and branch switcher stay — with a
 * way up to the parent list instead of only "home". Calm T4 neutral.
 */
export default async function DashboardNotFound() {
  const [t, session] = await Promise.all([getT(common), auth()]);
  const role = (session?.user?.role ?? null) as UserRole | null;
  return (
    <section aria-labelledby="not-found-title" data-testid="dashboard-not-found" className="mx-auto max-w-xl">
      <Card padding="lg" className="space-y-4">
        <div>
          <p className="text-sm font-semibold tabular-nums text-muted">{t('shell.notFound.eyebrow')}</p>
          <h1 id="not-found-title" className="mt-0.5 text-2xl font-bold text-ink">
            {t('shell.notFound.title')}
          </h1>
          <p className="mt-1.5 text-base text-muted">{t('shell.notFound.body')}</p>
        </div>
        <NotFoundActions role={role} />
      </Card>
    </section>
  );
}
