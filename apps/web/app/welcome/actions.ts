'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq, memberships, users } from '@restomatch/db';
import { auth } from '@/auth';
import { requireFullSession } from '@/lib/authGuards';
import { authDb } from '@/lib/authDb';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SEC } from '@/lib/i18n/config';
import { cleanName } from '../join/_lib/joinFlow';

/**
 * W3-07b first run: save the member's own name and app language, then go to
 * the role home. Writes only the caller's own user row and the caller's own
 * membership in the ACTIVE restaurant (identity zone, owner auth connection).
 */
export async function finishWelcomeAction(formData: FormData): Promise<void> {
  const { userId } = await requireFullSession();
  const session = await auth();
  const restaurantId = session?.user?.restaurantId ?? null;

  const name = cleanName(formData.get('name'));
  if (name) {
    await authDb.update(users).set({ name, updatedAt: new Date() }).where(eq(users.id, userId));
  }

  const lang = formData.get('lang');
  if (lang === 'he' || lang === 'en') {
    if (restaurantId) {
      await authDb
        .update(memberships)
        .set({ preferredLocale: lang })
        .where(and(eq(memberships.userId, userId), eq(memberships.restaurantId, restaurantId)));
    }
    const proto = (await headers()).get('x-forwarded-proto');
    (await cookies()).set(LOCALE_COOKIE, lang, {
      path: '/',
      maxAge: LOCALE_COOKIE_MAX_AGE_SEC,
      sameSite: 'lax',
      secure: proto === 'https' || process.env.NODE_ENV === 'production',
    });
  }
  redirect('/dashboard');
}
