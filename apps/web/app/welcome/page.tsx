import { Smartphone } from 'lucide-react';
import { eq, restaurants, users } from '@restomatch/db';
import { auth } from '@/auth';
import { requireFullSession } from '@/lib/authGuards';
import { authDb } from '@/lib/authDb';
import { Field, Input } from '@/lib/components';
import { auth as authMessages } from '@/lib/i18n/messages/auth';
import { getLocale, getT } from '@/lib/i18n/server';
import { AuthShell, authTitle } from '../(auth)/_components/AuthShell';
import { SubmitButton } from '../(auth)/_components/SubmitButton';
import { finishWelcomeAction } from './actions';

export const dynamic = 'force-dynamic';
export const generateMetadata = () => authTitle('welcome.titleNoName');

/**
 * W3-07b: the first run after joining — name, language and a short "add to
 * home screen" hint (the real install sheet is W3-03's), ending on the role
 * home (/dashboard routes each role to its own home).
 */
export default async function WelcomePage() {
  const { userId } = await requireFullSession();
  const session = await auth();
  const restaurantId = session?.user?.restaurantId ?? null;
  const [t, locale, [me], [rest]] = await Promise.all([
    getT(authMessages),
    getLocale(),
    authDb.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1),
    restaurantId
      ? authDb.select({ name: restaurants.name }).from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1)
      : Promise.resolve([] as { name: string }[]),
  ]);
  const current = locale === 'en' ? 'en' : 'he';

  return (
    <AuthShell>
      <h1 className="mb-2 text-xl font-bold text-ink">
        {rest?.name ? t('welcome.title', { restaurant: rest.name }) : t('welcome.titleNoName')}
      </h1>
      <p className="mb-6 text-base text-muted">{t('welcome.intro')}</p>
      <form action={finishWelcomeAction} className="space-y-5" data-testid="welcome-form">
        <Field label={t('welcome.nameLabel')} htmlFor="welcome-name">
          <Input
            id="welcome-name"
            name="name"
            defaultValue={me?.name ?? ''}
            minLength={2}
            maxLength={80}
            autoComplete="name"
            className="min-h-11 text-base"
          />
        </Field>
        <fieldset>
          <legend className="mb-1.5 block text-sm font-medium text-muted">{t('welcome.languageLabel')}</legend>
          <div className="flex gap-3">
            {(['he', 'en'] as const).map((l) => (
              <label
                key={l}
                className="flex min-h-11 flex-1 items-center gap-2 rounded-lg border border-line-strong px-3 text-base text-ink has-[:checked]:border-primary"
              >
                <input type="radio" name="lang" value={l} defaultChecked={l === current} className="h-5 w-5 accent-primary" />
                {l === 'he' ? 'עברית' : 'English'}
              </label>
            ))}
          </div>
        </fieldset>
        <section className="rounded-lg border border-line bg-surface-2 p-4" aria-labelledby="welcome-install">
          <h2 id="welcome-install" className="mb-2 flex items-center gap-2 text-base font-semibold text-ink">
            <Smartphone className="h-5 w-5 text-muted" aria-hidden="true" />
            {t('welcome.installTitle')}
          </h2>
          <p className="text-sm text-ink">{t('welcome.installIphone')}</p>
          <p className="text-sm text-ink">{t('welcome.installAndroid')}</p>
        </section>
        <SubmitButton className="min-h-12 w-full text-base">{t('welcome.finish')}</SubmitButton>
      </form>
    </AuthShell>
  );
}
