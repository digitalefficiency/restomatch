import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    // Food cost per dish (wave 1, flag `recipes`): the chef owns the recipes.
    key: 'recipes',
    path: '/dashboard/recipes',
    group: 'kitchen',
    rank: 10,
    roles: ['owner', 'manager', 'chef'],
    features: ['recipes'],
    nav: 'item',
    bar: { chef: { slot: 3, label: 'dishes' } },
    aliases: ['מנה', 'מנות', 'עלות מזון', 'recipes', 'dishes', 'food cost'],
  },
  { key: 'recipesNew', path: '/dashboard/recipes/new', group: 'kitchen', parent: 'recipes', nav: 'linked' },
  { key: 'recipeDetail', path: '/dashboard/recipes/[recipeId]', group: 'kitchen', parent: 'recipes', nav: 'detail' },
];
