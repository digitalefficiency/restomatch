import 'server-only';
import { authDb } from '@/lib/authDb';
import { db } from '@/lib/db';
import { lookupPortalContact, type PortalContact } from './contactLookup';

/** The portal's contact for this link — see lookupPortalContact for the rules. */
export function portalContact(token: string): Promise<PortalContact | null> {
  return lookupPortalContact({ adminDb: authDb, db }, token);
}
