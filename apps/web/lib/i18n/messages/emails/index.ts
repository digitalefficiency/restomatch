import { defineMessages } from '../../translate';
import { en } from './en';
import { he } from './he';

/**
 * 'emails' namespace: the transactional e-mail copy. The source of truth is
 * packages/api `notifications/copy` (EMAIL_COPY, W2-13), because the worker and the
 * API render the mails and cannot import apps/web. This namespace wraps the same
 * object so the he/en parity test and the copy gate cover every e-mail string.
 */
export const emails = defineMessages('emails', he, en);
