import 'server-only';
import { cookies } from 'next/headers';
import { HINT_COOKIE, HINT_MAX_AGE_SEC, decodeHint, encodeHint, type LoginHint } from './hintCodec';

/** The sign-in hint of this browser (see hintCodec). */
export async function readHint(): Promise<LoginHint | null> {
  return decodeHint((await cookies()).get(HINT_COOKIE)?.value);
}

/** Server actions only (a server component cannot write cookies). */
export async function writeHint(h: LoginHint): Promise<void> {
  (await cookies()).set(HINT_COOKIE, encodeHint(h), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/login',
    maxAge: HINT_MAX_AGE_SEC,
  });
}

/** Every sign-out in the auth pages calls this: the next person on a shared device starts clean. */
export async function clearHint(): Promise<void> {
  (await cookies()).set(HINT_COOKIE, '', { path: '/login', maxAge: 0 });
}
