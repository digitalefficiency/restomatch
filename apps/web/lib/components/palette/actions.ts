import type { PaletteAction } from './sections';
import type { PaletteCopy } from './copy';

/**
 * The palette's "פעולות". Every action is a link: money moves (`money: true`)
 * open their confirm screen and never act from the palette. The caller drops
 * the ones the role cannot open (`canSeeRoute(role, href)`).
 */
export function defaultActions(c: PaletteCopy): PaletteAction[] {
  return [
    {
      id: 'approvals',
      label: c.actions.approvals,
      href: '/dashboard/approvals',
      keywords: ['אישור', 'approve', 'פער'],
      money: true,
    },
    {
      id: 'payRun',
      label: c.actions.payRun,
      href: '/dashboard/approvals/pay-run',
      keywords: ['תשלום', 'pay'],
      money: true,
    },
    {
      id: 'claims',
      label: c.actions.claims,
      href: '/dashboard/recovery',
      keywords: ['זיכוי', 'claim', 'credit'],
      money: true,
    },
    {
      id: 'newOrder',
      label: c.actions.newOrder,
      href: '/dashboard/orders/new',
      keywords: ['הזמנה', 'order', 'po'],
    },
    {
      id: 'receive',
      label: c.actions.receive,
      href: '/dashboard/receiving',
      keywords: ['משלוח', 'קבלה', 'receive'],
    },
    {
      id: 'newRecipe',
      label: c.actions.newRecipe,
      href: '/dashboard/recipes/new',
      keywords: ['מתכון', 'recipe'],
    },
  ];
}
