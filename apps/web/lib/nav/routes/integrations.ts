import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    // Wave-1 integrations hub (flag-gated in the page): accounting codes for
    // owner + bookkeeper, POS sales + procurement for owner + manager. First
    // nav entry (admin-08).
    key: 'integrations',
    path: '/dashboard/integrations',
    group: 'admin',
    rank: 20,
    roles: ['owner', 'manager', 'bookkeeper'],
    features: ['integrations'],
    nav: 'item',
    aliases: ['אינטגרציות', 'חיבורים', 'קופה', 'integrations', 'pos'],
  },
];
