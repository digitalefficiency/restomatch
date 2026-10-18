'use server';

import { signOut } from '@/auth';

/**
 * After a successful self-erasure (dsr.deleteMyAccount, which also bumps
 * token_version) clear this device's session cookie and return to /login.
 */
export async function signOutAfterDeletionAction(): Promise<void> {
  await signOut({ redirectTo: '/login?signedOut=1' });
}
