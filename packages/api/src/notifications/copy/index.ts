import { en } from './en';
import { he } from './he';

export type { CopyShape } from './shape';
export { fill, needsIsolation, escapeHtml, FSI, PDI, type CopyVars, type FillOptions } from './fill';

/**
 * Every e-mail subject/body string, he + en. `templates.ts` renders from it; the web
 * `emails` i18n namespace wraps it (parity test + copy gate).
 */
export const EMAIL_COPY = { he, en } as const;
export type EmailCopy = typeof he;
