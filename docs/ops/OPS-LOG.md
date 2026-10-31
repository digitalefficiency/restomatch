# OPS-LOG — production actions

The approval record for every production write: secret rotation, env change, redeploy, promote, rollback, backup, restore drill, SQL against production.
Rom fills in one row per action. **Never write a secret, password, key or connection string here.** Env vars by name only.

| Date / time (IST) | Action | Who | Result | Notes |
|---|---|---|---|---|
| 2026-10-31 21:30 | Pre-flight for rotation (`ROTATION-2026-11.he.md` §0) | Rom | | |
| 2026-11-01 07:30 | Backup before rotation (§1) | Rom | | backup file name only |
| | | | | |
