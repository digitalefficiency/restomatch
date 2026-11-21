/**
 * The sender block of a credit-request letter (pure, unit-tested), from the
 * letterhead the owner filled once (settings.letterhead) — no schema change.
 * The ח״פ falls back to the restaurant profile's. `empty` = nothing was filled
 * yet: the letter still prints (never blocked); owners / managers get a calm prompt.
 */
export interface LetterheadInput {
  legalName?: string;
  businessId?: string;
  address?: string;
  phone?: string;
  email?: string;
}

export interface LetterheadBlock {
  legalName: string | null;
  businessId: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  /** Nothing in the letterhead yet (the profile's ח״פ alone does not count). */
  empty: boolean;
}

const clean = (v: string | null | undefined) => (v ?? '').trim() || null;

export function letterheadBlock(lh: LetterheadInput | null | undefined, profileBusinessId: string | null | undefined): LetterheadBlock {
  const legalName = clean(lh?.legalName);
  const address = clean(lh?.address);
  const phone = clean(lh?.phone);
  const email = clean(lh?.email);
  const own = clean(lh?.businessId);
  return {
    legalName,
    businessId: own ?? clean(profileBusinessId),
    address,
    phone,
    email,
    empty: !legalName && !own && !address && !phone && !email,
  };
}

/** Who sees the "complete the letterhead" prompt: the roles that can fill it in. */
export function canEditLetterhead(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'manager';
}
