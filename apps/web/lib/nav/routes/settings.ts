import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    // Settings holds PERSONAL security (password, 2FA, language, DSR) for every
    // role; the restaurant sections inside are owner-edit / manager+bookkeeper
    // read-only / hidden for receiver + chef (see app/dashboard/settings/page.tsx).
    key: 'settings',
    path: '/dashboard/settings',
    group: 'admin',
    rank: 30,
    roles: ['owner', 'manager', 'receiver', 'bookkeeper', 'chef'],
    nav: 'item',
    aliases: ['הגדרות', 'סיסמה', 'אימות דו-שלבי', 'settings', 'password', '2fa'],
  },
];
