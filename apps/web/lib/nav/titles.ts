/** Product name in every tab title. */
export const TITLE_SUFFIX = 'RestoMatch';

/**
 * `document.title` for a dashboard page: `<label> · <branch> — RestoMatch`.
 * The branch shows only for users with two or more memberships.
 */
export function titleFor(label: string, branch?: string | null): string {
  return branch ? `${label} · ${branch} — ${TITLE_SUFFIX}` : `${label} — ${TITLE_SUFFIX}`;
}
