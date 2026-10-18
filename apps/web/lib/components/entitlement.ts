import type { Locale } from '@/lib/i18n/config';
import { createTranslator } from '@/lib/i18n/translate';
import { components } from '@/lib/i18n/messages/components';

/**
 * The cause attached to an ENTITLEMENT_REQUIRED TRPCError (see
 * `requireFeature` in @restomatch/api): `{ code, feature, planKey }`.
 * superjson preserves the cause object across the wire.
 *
 * Kept out of the 'use client' EntitlementUpsell module so server components
 * can call `entitlementCauseOf` (a client module's exports are references, not
 * callable functions, on the server).
 */
export interface EntitlementCause {
  code: 'ENTITLEMENT_REQUIRED';
  feature: string;
  planKey?: string | null;
}

/**
 * Detects whether a thrown/serialized error carries the ENTITLEMENT_REQUIRED
 * cause. Works for both server-side `TRPCError` (with `.cause`) and the
 * client-side `TRPCClientError` (which exposes the cause under `data` /
 * `shape.data` after superjson round-trips). Returns the typed cause or null.
 */
export function entitlementCauseOf(err: unknown): EntitlementCause | null {
  if (!err || typeof err !== 'object') return null;
  // Direct TRPCError.cause (server caller path).
  const direct = (err as { cause?: unknown }).cause;
  if (isEntitlementCause(direct)) return direct;
  // Some serialized shapes nest it under data.cause.
  const data = (err as { data?: { cause?: unknown } }).data;
  if (data && isEntitlementCause(data.cause)) return data.cause;
  // Client side the cause is not serialized; the gate's message carries the key.
  const message = (err as { message?: unknown }).message;
  if (typeof message === 'string') {
    const m = /^ENTITLEMENT_REQUIRED:(\w+)$/.exec(message.trim());
    if (m) return { code: 'ENTITLEMENT_REQUIRED', feature: m[1]! };
  }
  return null;
}

function isEntitlementCause(c: unknown): c is EntitlementCause {
  return (
    !!c &&
    typeof c === 'object' &&
    (c as { code?: unknown }).code === 'ENTITLEMENT_REQUIRED' &&
    typeof (c as { feature?: unknown }).feature === 'string'
  );
}

const FEATURE_KEYS = ['advanced_analytics', 'accounting_export', 'whatsapp_alerts', 'integrations'] as const;
type FeatureKey = (typeof FEATURE_KEYS)[number];

/** Localized label for a feature key, falling back to the raw key. */
export function featureLabel(feature: string, locale: Locale = 'he'): string {
  if (!(FEATURE_KEYS as readonly string[]).includes(feature)) return feature;
  return createTranslator(locale, components)(`entitlement.features.${feature as FeatureKey}`);
}
