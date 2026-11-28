/**
 * W3-02 COVERAGE fragment (format of W2-01's coverage/README.md). Plain record
 * type on purpose: it compiles before W2-01's ./index.ts is on main.
 */
const coverage: Readonly<Record<string, string>> = {
  'recipes.preview':
    "attack — recipes-preview.attack.test.ts: A's draft with B's product / sub-recipe / recipe id → NOT_FOUND (never costed at B's prices, same answer as an unknown id); no row written",
  'inventory.controlRoom':
    "attack — inventory-control-room.attack.test.ts: B's control room holds only B's counts (never A's ids or ₪); chef and receiver FORBIDDEN",
};
export default coverage;
