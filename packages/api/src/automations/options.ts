/**
 * AU-01 · the one reader of an automation option.
 *
 * Options live in `restaurants.settings.automations` (jsonb, no schema change):
 *   { "automations": { "eveningDigest": false } }
 * A missing or non-boolean value falls back to the registry default, so the
 * ungated jobs (order reminders, late trucks, evening digest) keep today's
 * behaviour until the owner turns one off. AU-03 / AU-04 import this — never
 * read `settings.automations` directly.
 */
import { optionDefault, type AutomationOptionKey } from './registry';

export function storedAutomationOptions(settings: unknown): Partial<Record<AutomationOptionKey, boolean>> {
  const a = (settings as { automations?: unknown } | null | undefined)?.automations;
  return a && typeof a === 'object' && !Array.isArray(a) ? (a as Partial<Record<AutomationOptionKey, boolean>>) : {};
}

export function automationOption(settings: unknown, key: AutomationOptionKey): boolean {
  const v = storedAutomationOptions(settings)[key];
  return typeof v === 'boolean' ? v : optionDefault(key);
}

// The package's public surface in one place (one export line in api/index.ts).
export { AUTOMATIONS, type AutomationDef, type AutomationOptionKey } from './registry';
