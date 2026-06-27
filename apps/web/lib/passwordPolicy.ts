/**
 * Minimum password policy (Epic B). Pure + dependency-free so it can run on the
 * client for instant feedback and be re-validated on the server (the server is
 * the authority). Deliberately length-first (NIST 800-63B): a long passphrase
 * beats arbitrary composition rules.
 */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

export function passwordPolicyError(password: string): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `הסיסמה ארוכה מדי (עד ${MAX_PASSWORD_LENGTH} תווים).`;
  }
  return null;
}

export function isAcceptablePassword(password: string): boolean {
  return passwordPolicyError(password) === null;
}
