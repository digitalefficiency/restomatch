import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    // Food cost per dish (wave 1, flag `recipes`): the chef owns the recipes.
    key: 'recipes',
    path: '/dashboard/recipes',
    group: 'kitchen',
    rank: 10,
    // Owner decision (orchestrator, 7.11): the bookkeeper reads everything — read-only here
    // (W3-02 #281 serves the recipes.* read tier, ₪ visible; every write stays chef/manager,
    // recipes-bookkeeper.attack.test.ts). The UI is read-only through the IA lens.
    roles: ['owner', 'manager', 'chef', 'bookkeeper'],
    features: ['recipes'],
    nav: 'item',
    badge: null,
    bar: { chef: { slot: 3, label: 'dishes' } },
    aliases: ['מנה', 'מנות', 'עלות מזון', 'recipes', 'dishes', 'food cost'],
  },
  {
    key: 'recipesNew',
    path: '/dashboard/recipes/new',
    group: 'kitchen',
    parent: 'recipes',
    // Explicit, so prefix inheritance never hands the bookkeeper the create form (7.11: she reads, never writes).
    roles: ['owner', 'manager', 'chef'],
    nav: 'linked',
    badge: null,
  },
  { key: 'recipeDetail', path: '/dashboard/recipes/[recipeId]', group: 'kitchen', parent: 'recipes', nav: 'detail', badge: null },
];
