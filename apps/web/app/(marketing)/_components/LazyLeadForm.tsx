'use client';

import { LeadForm, type LeadFormAction } from './LeadForm';

/**
 * W3-06: the lead form is server-rendered in place so it posts through its
 * Server Action even with JS off (progressive enhancement). It used to be a
 * `dynamic()` import mounted on scroll; a lazy/Suspense boundary streams the
 * form into a hidden slot that only JS reveals, so it is imported directly.
 * Without the tRPC client the form's JS is small. The server page passes the
 * action in as a prop (a server reference), which is also what keeps the
 * no-JS POST working under `next dev --turbopack`.
 */
export function LazyLeadForm({ action }: { action: LeadFormAction }) {
  return <LeadForm action={action} />;
}
