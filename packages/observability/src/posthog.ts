/**
 * PostHog event tracker — no SDK, just fetch.
 *
 * Set env vars to enable:
 *   POSTHOG_API_KEY — project API key (starts with "phc_")
 *   POSTHOG_HOST    — typically "https://eu.i.posthog.com"
 *
 * No-op if env vars aren't set. Errors are swallowed (analytics should
 * never break the application).
 */

export interface PostHogEvent {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
  groups?: Record<string, string>;
  timestamp?: Date;
}

interface PostHogConfig {
  apiKey: string;
  host: string;
}

function readConfig(): PostHogConfig | null {
  const apiKey = process.env.POSTHOG_API_KEY;
  const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com';
  if (!apiKey) return null;
  return { apiKey, host };
}

/**
 * Fire-and-forget event capture. Returns true if sent to PostHog,
 * false if no API key was configured.
 */
export async function captureEvent(event: PostHogEvent): Promise<boolean> {
  const config = readConfig();
  if (!config) return false;

  try {
    await fetch(`${config.host}/i/v0/e/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: config.apiKey,
        event: event.event,
        distinct_id: event.distinctId,
        properties: event.properties ?? {},
        groups: event.groups,
        timestamp: (event.timestamp ?? new Date()).toISOString(),
      }),
    });
    return true;
  } catch {
    // Analytics failures must never bubble
    return false;
  }
}

/** Convenience — track a generic action with restaurant + user context. */
export async function trackRestaurantEvent(params: {
  event: string;
  userId: string;
  restaurantId: string;
  properties?: Record<string, unknown>;
}): Promise<boolean> {
  return captureEvent({
    event: params.event,
    distinctId: params.userId,
    groups: { restaurant: params.restaurantId },
    properties: params.properties,
  });
}

export function isEnabled(): boolean {
  return readConfig() !== null;
}
