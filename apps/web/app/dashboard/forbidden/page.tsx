import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Lock, Mail, MessageCircle } from 'lucide-react';
import type { UserRole } from '@restomatch/db';
import { auth } from '@/auth';
import { Card, LinkButton } from '@/lib/components';
import { getLocale, getT } from '@/lib/i18n/server';
import { common } from '@/lib/i18n/messages/common';
import { originalProps } from '@/lib/i18n/original';
import { forbiddenFrom, screenKeyForPath } from '@/lib/net/access';
import { ALL_ROLES, allowedRolesForPath, labelForRole } from '@/lib/roles';
import { createServerCaller } from '@/lib/trpc/server';
import { SwitchBranchButton } from '../chain/switch-button';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(common);
  return { title: `${t('shell.forbidden.eyebrow')} — RestoMatch` };
}

/** "a, b and c" in the active locale. */
function joinList(items: string[], sep: string, last: string): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(sep)}${last}${items[items.length - 1]}`;
}

/**
 * The in-shell forbidden page (W1-04, ia-nav-07; lens-ia-nav §10.1). The
 * middleware REWRITES a role-forbidden /dashboard URL here (HTTP 403), so the
 * address bar keeps the link the user was given. T4 calm, never warn: it names
 * the screen, who can open it, a prefilled access request, and — when another
 * membership allows it — "פתחו ב־<branch>". `?reason=notMember` is the
 * `/dashboard/go` refusal (a link to a branch this user doesn't belong to).
 */
export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; reason?: string }>;
}) {
  const { from: rawFrom, reason } = await searchParams;
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const [t, locale, memberships] = await Promise.all([
    getT(common),
    getLocale(),
    createServerCaller().then((c) => c.onboarding.myMemberships()),
  ]);
  const from = forbiddenFrom(rawFrom) ?? '/dashboard';
  const fromPath = from.split(/[?#]/)[0] ?? '/dashboard';
  const activeId = session.user.restaurantId ?? null;
  const active = memberships.find((m) => m.restaurantId === activeId) ?? memberships[0];
  const role = (active?.role ?? session.user.role ?? null) as UserRole | null;
  const allowed = allowedRolesForPath(fromPath) ?? ALL_ROLES;
  const notMember = reason === 'notMember';

  // Opened directly (or the role changed since): nothing is forbidden any more.
  if (!notMember && role && allowed.includes(role) && fromPath !== '/dashboard/forbidden') redirect(from);

  const screen = t(`shell.screens.${screenKeyForPath(fromPath)}`);
  const roles = joinList(
    ALL_ROLES.filter((r) => allowed.includes(r)).map((r) => labelForRole(r, locale)),
    t('shell.listSep'),
    t('shell.listLast'),
  );
  const branchName = active?.restaurantName ?? '';
  const elsewhere = notMember
    ? []
    : memberships
        .filter((m) => m.restaurantId !== active?.restaurantId && allowed.includes(m.role as UserRole))
        .sort((a, b) => a.restaurantName.localeCompare(b.restaurantName, 'he'));

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const url = host ? `${proto}://${host}${from}` : from;
  const requestText = t('shell.forbidden.requestText', { screen, branch: branchName, url });
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(requestText)}`;
  const mail = `mailto:?subject=${encodeURIComponent(t('shell.forbidden.requestSubject', { screen }))}&body=${encodeURIComponent(requestText)}`;

  return (
    <section aria-labelledby="forbidden-title" data-testid="forbidden-page" className="mx-auto max-w-xl">
      <Card padding="lg" className="space-y-5">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted ring-1 ring-line">
            <Lock className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-muted">{t('shell.forbidden.eyebrow')}</p>
            <h1 id="forbidden-title" className="mt-0.5 text-2xl font-bold text-ink">
              {notMember ? t('shell.forbidden.notMemberTitle') : t('shell.forbidden.title', { screen })}
            </h1>
          </div>
        </div>

        {notMember ? (
          <p className="text-base text-ink">{t('shell.forbidden.notMember')}</p>
        ) : (
          <div className="space-y-1 text-base text-ink">
            <p data-testid="forbidden-roles">{t('shell.forbidden.allowed', { roles })}</p>
            {role ? (
              <p className="text-muted">
                {t('shell.forbidden.youAre', { role: labelForRole(role, locale), branch: '⁨' + branchName + '⁩' })}
              </p>
            ) : null}
          </div>
        )}

        {elsewhere.length > 0 ? (
          <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-3">
            <p className="text-sm font-semibold text-ink">{t('shell.forbidden.openInHint')}</p>
            <ul className="space-y-2">
              {elsewhere.map((m) => (
                <li key={m.restaurantId} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-ink">
                    <span {...originalProps(m.restaurantName)}>{m.restaurantName}</span>
                    <span className="text-muted"> · {labelForRole(m.role, locale)}</span>
                  </span>
                  <SwitchBranchButton
                    restaurantId={m.restaurantId}
                    branchName={m.restaurantName}
                    then={from}
                    variant="primary"
                    testId="forbidden-open-in"
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="space-y-2">
          <h2 className="text-base font-bold text-ink">{t('shell.forbidden.requestTitle')}</h2>
          <p className="text-sm text-muted">{t('shell.forbidden.requestBody')}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="forbidden-whatsapp"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line-strong bg-surface px-4 text-sm font-semibold text-ink hover:border-primary/40 hover:text-primary"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              {t('shell.forbidden.whatsapp')}
            </a>
            <a
              href={mail}
              data-testid="forbidden-email"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line-strong bg-surface px-4 text-sm font-semibold text-ink hover:border-primary/40 hover:text-primary"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              {t('shell.forbidden.email')}
            </a>
          </div>
        </div>

        <div className="border-t border-line pt-4">
          <LinkButton href="/dashboard" variant="secondary" className="min-h-[44px]">
            {t('shell.forbidden.home')}
          </LinkButton>
        </div>
      </Card>
    </section>
  );
}
