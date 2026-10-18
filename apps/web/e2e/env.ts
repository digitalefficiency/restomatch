import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Shared by playwright.config.ts and the specs (specs must not import the config). */
export const PORT = Number(process.env.E2E_PORT ?? 3100);
export const MAGIC_LINK_FILE = join(tmpdir(), `restomatch-magic-link-${PORT}.json`);
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/restomatch_e2e';
/** Throwaway 32-byte hex key so e2e can enroll TOTP (secrets are encrypted at rest with it). */
export const E2E_AUTH_ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
/** The seeded demo tenant (packages/db/scripts/seed.ts). */
export const DEMO_OWNER_EMAIL = 'owner@kfar-hazeitim.test';
export const DEMO_RESTAURANT_NAME = 'כפר הזיתים';
/** Saved session of the demo owner (written by e2e/auth.setup.ts). */
export const OWNER_STATE = 'test-results/.auth/owner.json';
