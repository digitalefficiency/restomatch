/**
 * Web email templates — single source of truth lives in
 * `@restomatch/api` (packages/api/src/notifications/templates.ts) so the
 * dashboard, auth flow, and the worker's outbox all render identical branded
 * Hebrew RTL emails. This file is a thin re-export kept for the existing import
 * paths (auth.ts, dashboard/team/actions.ts).
 */
export type { RenderedEmail as EmailContent } from '@restomatch/api';
export { magicLinkEmail, inviteEmail, passwordResetEmail } from '@restomatch/api';
