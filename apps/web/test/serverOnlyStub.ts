// Test stub for the `server-only` package: importing it must be a no-op under
// vitest (the real module throws if pulled into a client bundle). Aliased in
// vitest.config.ts so server-only libs (lib/passwords.ts, lib/email.ts, …) can
// be unit-tested in a node environment.
export {};
