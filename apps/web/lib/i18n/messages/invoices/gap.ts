import type { Shape } from '../../translate';

/**
 * The words every screen of the invoices area shares (with whom a gap is, since when, why,
 * what was decided and by which role), merged into the 'invoices' namespace as `gap.*` by
 * ./index.ts. Owner: INV-00. Screens print these through `apps/web/lib/invoices/words.ts`
 * and write no role word or rule phrase of their own.
 *
 * Role words, three forms each (`bare` · `the` · `to`): בעלים, ניהול, הנהלת חשבונות. Never the
 * retired "מנהל".
 */
export const gapHe = {
  role: {
    owner: { bare: 'בעלים', the: 'הבעלים', to: 'לבעלים' },
    manager: { bare: 'ניהול', the: 'הניהול', to: 'לניהול' },
    bookkeeper: { bare: 'הנהלת חשבונות', the: 'הנהלת החשבונות', to: 'להנהלת החשבונות' },
  },
  /** With whom a gap is: "אצלכם" when it is routed to the viewer's own role. */
  who: {
    mine: 'אצלכם',
    owner: 'אצל הבעלים',
    manager: 'אצל הניהול',
    bookkeeper: 'אצל הנהלת החשבונות',
  },
};

export const gapEn: Shape<typeof gapHe> = {
  role: {
    owner: { bare: 'Owner', the: 'the owner', to: 'to the owner' },
    manager: { bare: 'Management', the: 'management', to: 'to management' },
    bookkeeper: { bare: 'Bookkeeping', the: 'bookkeeping', to: 'to bookkeeping' },
  },
  who: {
    mine: 'With you',
    owner: 'With the owner',
    manager: 'With management',
    bookkeeper: 'With bookkeeping',
  },
};
