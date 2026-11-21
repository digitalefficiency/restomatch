/** 'emails' namespace, English: re-exported from packages/api EMAIL_COPY (W2-13). Edit the copy there. */
import { EMAIL_COPY } from '@restomatch/api';
import type { Shape } from '../../translate';
import type { he } from './he';

export const en: Shape<typeof he> = EMAIL_COPY.en;
