/**
 * AU-01 COVERAGE fragment (W2-01 pattern; loaded once W2-01 merges). Add-only.
 * Typed inline so this file compiles before coverage/index.ts exists on main.
 */
const coverage: Readonly<Record<string, string>> = {
  'automations.list':
    "isolation — automations.attack.test.ts: B's outbox rows never count on A's list; receiver/chef FORBIDDEN",
  'automations.setEnabled':
    "attack — automations.attack.test.ts: A's owner writes only A's settings (no restaurantId input); B untouched",
  'automations.listForAdmin':
    'attack — automations.attack.test.ts: a non-admin tenant owner → FORBIDDEN for any restaurantId',
};
export default coverage;
