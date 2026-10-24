/**
 * Honest delivery state for a supplier order message. notifications_outbox has
 * no "skipped" status (the enum is schema), so the dispatcher parks a row it
 * could not send for lack of a provider as `failed` with this marker in
 * last_error — never `sent`.
 */
import { isResendConfigured, isWhatsAppCloudConfigured, type NotifierFactoryEnv } from './factory';

export const SKIPPED_NO_PROVIDER = 'skipped_no_provider';

export type SupplierMessageState = 'sent' | 'pending' | 'not_configured' | 'failed';

/** Is there a real provider for this channel in `env`? (push has none yet.) */
export function providerConfigured(
  channel: 'email' | 'whatsapp' | 'push',
  env: NotifierFactoryEnv = process.env as NotifierFactoryEnv,
): boolean {
  if (channel === 'email') return isResendConfigured(env);
  if (channel === 'whatsapp') return isWhatsAppCloudConfigured(env);
  return false;
}

export function supplierMessageState(
  row: { status: string; lastError: string | null; channel: 'email' | 'whatsapp' | 'push' },
  env: NotifierFactoryEnv = process.env as NotifierFactoryEnv,
): SupplierMessageState {
  if (row.status === 'sent') return 'sent';
  if (row.lastError === SKIPPED_NO_PROVIDER) return 'not_configured';
  if (row.status === 'failed' || row.status === 'cancelled') return 'failed';
  // queued / sending: it will only ever leave if a provider exists.
  return providerConfigured(row.channel, env) ? 'pending' : 'not_configured';
}
