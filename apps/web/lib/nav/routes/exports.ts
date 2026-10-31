import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    key: 'exports',
    path: '/dashboard/exports',
    group: 'money',
    rank: 70,
    roles: ['owner', 'bookkeeper'],
    nav: 'item',
    aliases: ['ייצוא', 'סגירת חודש', 'הנהלת חשבונות', 'export', 'close'],
  },
];
