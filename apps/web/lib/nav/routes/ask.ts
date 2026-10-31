import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    // AI assistant (S14, flag aiAssistant): owner + manager only.
    key: 'ask',
    path: '/dashboard/ask',
    group: 'leaks',
    rank: 40,
    roles: ['owner', 'manager'],
    features: ['aiAssistant'],
    nav: 'item',
    aliases: ['שאלו', 'שאלה', 'ask', 'ai'],
  },
];
