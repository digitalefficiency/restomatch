/**
 * Onboarding form rules (auth-21, auth-27), pure so they unit-test. The server
 * re-validates everything (onboarding.createRestaurant); these only decide what
 * the owner sees inline, in their language, before anything is sent.
 */
export type OnboardingField = 'yourName' | 'name' | 'businessId';
export const FIELD_ORDER: readonly OnboardingField[] = ['yourName', 'name', 'businessId'];

// C0 controls + DEL (a name ends up in email headers — same rule as the API).
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** "51-477812-3" / "514 778 123" → "514778123" (dashes and spaces are stripped, not rejected). */
export function normalizeBusinessId(raw: string): string {
  return raw.replace(/[-\s‐-―]/g, '');
}

export interface OnboardingInput {
  yourName: string;
  name: string;
  businessId: string;
}

export function validateOnboarding(input: OnboardingInput): {
  values: { yourName: string; name: string; businessId: string | undefined };
  errors: Partial<Record<OnboardingField, true>>;
} {
  const yourName = input.yourName.trim();
  const name = input.name.trim();
  const businessId = normalizeBusinessId(input.businessId.trim());
  const errors: Partial<Record<OnboardingField, true>> = {};
  if (yourName.length < 2 || yourName.length > 80 || CONTROL_CHARS.test(yourName)) errors.yourName = true;
  if (name.length < 2 || name.length > 120 || CONTROL_CHARS.test(name)) errors.name = true;
  if (businessId && !/^\d{9,12}$/.test(businessId)) errors.businessId = true;
  return { values: { yourName, name, businessId: businessId || undefined }, errors };
}

/** The first invalid field in visual order — it receives focus. */
export function firstInvalid(errors: Partial<Record<OnboardingField, true>>): OnboardingField | null {
  return FIELD_ORDER.find((f) => errors[f]) ?? null;
}
