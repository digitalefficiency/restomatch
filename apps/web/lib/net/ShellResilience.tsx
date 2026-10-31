'use client';

import { useEffect, useRef, useState } from 'react';
import { getSession, signIn } from 'next-auth/react';
import { LogIn, WifiOff } from 'lucide-react';
import { Button, cn, Field, Input } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { common } from '@/lib/i18n/messages/common';
import { useOnline } from './online';
import { switchBranchAction } from '@/app/dashboard/branch-actions';
import { abandonReauth, completeReauth, dismissReauth, useReauthOpen } from './reauth';
import { decideAfterSignIn } from './reauthDecision';

/**
 * The shell's "no dead ends" layer (W1-04; lens-perf-states §2.5), mounted once
 * by TrpcProvider on authenticated surfaces:
 *
 * - **Offline chip** (perf-states-08): T4 neutral, never red, polite live
 *   region, under the header. Shown within ~0 s of the `offline` event.
 * - **Re-auth sheet** (perf-states-15): an `UNAUTHORIZED` tRPC answer opens it
 *   IN PLACE. The page stays mounted (counts, order lines, typed text survive).
 *   After sign-in, failed READS re-fetch; a failed action is never replayed —
 *   its own control already says "not sent" and the user taps again. The page
 *   keeps its branch (a fresh login is switched back before anything re-runs);
 *   somebody else signing in reloads home — one worker's screen never acts for
 *   another (lib/net/reauthDecision.ts).
 */
export function ShellResilience({ identity }: { identity?: Identity }) {
  return (
    <>
      <OfflineChip />
      <ReauthSheet identity={identity} />
    </>
  );
}

function OfflineChip() {
  const t = useT(common);
  const online = useOnline();
  return (
    // The live region is always mounted, so the chip appearing is announced.
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[calc(var(--rm-header-h,4.25rem)+0.5rem)] z-40 flex justify-center px-4 lg:top-[calc(var(--rm-header-h,7.25rem)+0.5rem)]"
    >
      {online ? null : (
        <p
          data-testid="offline-chip"
          className="pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-ink shadow-card"
        >
          <WifiOff className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          <span>{t('shell.offline.chip')}</span>
        </p>
      )}
    </div>
  );
}

/** Whose page this is: the signed-in user and the branch the page was rendered for. */
export interface Identity {
  id: string;
  email: string;
  restaurantId: string | null;
}

type Phase =
  | { kind: 'form' }
  | { kind: 'wrong' }
  | { kind: 'twoFactor' }
  | { kind: 'stillOut' }
  | { kind: 'magicSent'; email: string }
  | { kind: 'magicFailed' }
  | { kind: 'otherUser' };

/** Who is signed in right now (null when the session is gone or 2FA is pending). */
async function currentIdentity(): Promise<(Identity & { pending: boolean }) | null> {
  const s = (await getSession().catch(() => null)) as
    | { user?: { id?: string; email?: string | null; twoFactorPending?: boolean; restaurantId?: string | null } }
    | null;
  const id = s?.user?.id;
  if (!id) return null;
  return {
    id,
    email: s?.user?.email ?? '',
    restaurantId: s?.user?.restaurantId ?? null,
    pending: s?.user?.twoFactorPending === true,
  };
}

function ReauthSheet({ identity }: { identity?: Identity }) {
  const t = useT(common);
  const open = useReauthOpen();
  const ref = useRef<HTMLDialogElement>(null);
  // Fixed ids, like #reauth-email: one sheet per page. useId() here came out
  // different on the server and the client on a route's first render in dev
  // (the sheet renders after the page's {children}), which logged a hydration
  // mismatch on aria-labelledby/-describedby.
  const titleId = 'reauth-title';
  const bodyId = 'reauth-body';
  // The user this page belongs to: from the server when the layout passes it,
  // otherwise read once while the session is still alive.
  const owner = useRef<Identity | null>(identity ?? null);
  const [email, setEmail] = useState(identity?.email ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });

  // A refreshed layout (another branch) re-renders with the page's new owner.
  const ownerId = identity?.id;
  const ownerBranch = identity?.restaurantId ?? null;
  const ownerEmail = identity?.email ?? '';
  useEffect(() => {
    if (ownerId) owner.current = { id: ownerId, email: ownerEmail, restaurantId: ownerBranch };
  }, [ownerId, ownerBranch, ownerEmail]);

  useEffect(() => {
    // Known from the server: no session read on mount. GET /api/auth/session
    // re-issues the session cookie, and one answered after a branch switch had set
    // the new branch put the old one back (the switch was silently lost); a full
    // navigation during the read also logged a ClientFetchError.
    if (owner.current) return;
    let alive = true;
    void currentIdentity().then((who) => {
      if (!alive || !who || who.pending) return;
      owner.current = { id: who.id, email: who.email, restaurantId: who.restaurantId };
      setEmail((e) => e || who.email);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d || typeof d.showModal !== 'function') return;
    if (!open) {
      if (d.open) d.close();
      return;
    }
    if (d.open) return;
    let alive = true;
    // An UNAUTHORIZED with a still-valid session is not an expiry (review minor 5):
    // never show the sheet for it, so it cannot flap or wipe a typed password.
    void currentIdentity().then((who) => {
      if (!alive) return;
      if (who && !who.pending && owner.current?.id === who.id) {
        abandonReauth();
        return;
      }
      setPhase({ kind: 'form' });
      setPassword('');
      d.showModal();
    });
    return () => {
      alive = false;
    };
  }, [open]);

  // Signed in from another tab (magic link, 2FA page): pick it up on return.
  useEffect(() => {
    if (!open) return;
    const onFocus = () => void finish(false);
    window.addEventListener('focus', onFocus);
    const poll = window.setInterval(() => void finish(false), 4_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(poll);
    };
  }, [open]);

  /** Check the session and act on it (reauthDecision). `loud` = the user asked (shows "still signed out"). */
  async function finish(loud: boolean): Promise<boolean> {
    const who = await currentIdentity();
    const next = decideAfterSignIn(
      owner.current ? { id: owner.current.id, restaurantId: owner.current.restaurantId } : null,
      who,
    );
    switch (next.kind) {
      case 'stillOut':
        if (loud) setPhase({ kind: 'stillOut' });
        return false;
      case 'twoFactor':
        setPhase({ kind: 'twoFactor' });
        return false;
      case 'reload':
        setPhase({ kind: 'otherUser' });
        abandonReauth();
        window.location.assign('/dashboard');
        return true;
      case 'switchBack': {
        // Restore the branch this page belongs to before anything re-runs.
        const res = await switchBranchAction(next.restaurantId).catch(() => ({ ok: false as const }));
        const after = res.ok ? await currentIdentity() : null;
        if (!after || after.restaurantId !== next.restaurantId) {
          abandonReauth();
          window.location.assign('/dashboard');
          return true;
        }
        completeReauth();
        return true;
      }
      case 'resume':
        completeReauth();
        return true;
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await signIn('credentials', { email, password, rememberMe: 'false', redirect: false });
      setPassword('');
      if (!res || res.error) {
        setPhase({ kind: 'wrong' });
        return;
      }
      await finish(true);
    } catch {
      setPhase({ kind: 'wrong' });
    } finally {
      setBusy(false);
    }
  }

  async function onMagicLink() {
    if (busy || !email) return;
    setBusy(true);
    try {
      const here = `${window.location.pathname}${window.location.search}`;
      const res = await signIn('nodemailer', { email, redirect: false, redirectTo: here });
      setPhase(res && !res.error ? { kind: 'magicSent', email } : { kind: 'magicFailed' });
    } catch {
      setPhase({ kind: 'magicFailed' });
    } finally {
      setBusy(false);
    }
  }

  const message =
    phase.kind === 'wrong'
      ? t('shell.session.wrong')
      : phase.kind === 'stillOut'
        ? t('shell.session.stillOut')
        : phase.kind === 'magicFailed'
          ? t('shell.session.magicFailed')
          : phase.kind === 'otherUser'
            ? t('shell.session.otherUser')
            : null;
  const here = typeof window === 'undefined' ? '/dashboard' : `${window.location.pathname}${window.location.search}`;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-testid="reauth-sheet"
      // Esc / backdrop close the sheet; the parked calls wait for the next sign-in.
      onClose={() => open && dismissReauth()}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      className="mb-0 mt-auto w-full max-w-none rounded-t-2xl border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-black/50 sm:!m-auto sm:w-[min(92vw,28rem)] sm:rounded-2xl"
    >
      {open ? (
        <div className="space-y-4 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted ring-1 ring-line">
              <LogIn className="h-5 w-5 rtl:-scale-x-100" aria-hidden="true" />
            </span>
            <div>
              <h2 id={titleId} className="text-lg font-bold text-ink">
                {t('shell.session.title')}
              </h2>
              <p id={bodyId} className="mt-0.5 text-sm text-muted">
                {t('shell.session.body')}
              </p>
            </div>
          </div>

          {phase.kind === 'twoFactor' ? (
            <div className="space-y-3">
              <p className="text-sm text-ink">{t('shell.session.twoFactor')}</p>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/login/2fa?callbackUrl=${encodeURIComponent(here)}`}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex min-h-[44px] items-center rounded-lg border border-line bg-surface-2 px-3 text-sm font-semibold text-primary hover:border-primary/40"
                >
                  {t('shell.session.openTwoFactor')}
                </a>
                <Button variant="primary" onClick={() => void finish(true)}>
                  {t('shell.session.checkAgain')}
                </Button>
              </div>
            </div>
          ) : phase.kind === 'magicSent' ? (
            <div className="space-y-3">
              <p className="text-sm text-ink" role="status">
                {t('shell.session.magicSent', { email: phase.email })}
              </p>
              <Button variant="primary" onClick={() => void finish(true)}>
                {t('shell.session.checkAgain')}
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-3" noValidate>
              <Field label={t('shell.session.email')} htmlFor="reauth-email">
                <Input
                  id="reauth-email"
                  type="email"
                  autoComplete="username"
                  dir="ltr"
                  required
                  value={email}
                  readOnly={Boolean(owner.current?.email)}
                  onChange={(e) => setEmail(e.target.value)}
                  className={cn('text-base', owner.current?.email && 'bg-surface-2 text-muted')}
                />
              </Field>
              <Field label={t('shell.session.password')} htmlFor="reauth-password">
                <Input
                  id="reauth-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="text-base"
                />
              </Field>
              {message ? (
                <p role="alert" className="text-sm font-semibold text-danger">
                  {message}
                </p>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row-reverse sm:items-center sm:justify-between">
                <Button type="submit" variant="primary" loading={busy} disabled={!email || !password} className="min-h-[48px] w-full sm:w-auto">
                  {busy ? t('shell.session.submitting') : t('shell.session.submit')}
                </Button>
                <button
                  type="button"
                  onClick={() => void onMagicLink()}
                  disabled={busy || !email}
                  className="min-h-[44px] text-start text-sm font-semibold text-primary underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {t('shell.session.magicLink')}
                </button>
              </div>
              {/* Shared tablets (owner decision §8): each worker has their own login.
                  A different person goes through the full sign-in; nothing of this
                  page's work is replayed for them. */}
              {owner.current?.email ? (
                <a
                  href="/login?callbackUrl=%2Fdashboard"
                  data-testid="reauth-other-user"
                  className="flex min-h-[48px] items-center justify-center rounded-xl border border-line text-sm font-semibold text-ink hover:border-primary/40 hover:text-primary"
                >
                  {t('shell.session.otherUserLink')}
                </a>
              ) : null}
            </form>
          )}
        </div>
      ) : null}
    </dialog>
  );
}
