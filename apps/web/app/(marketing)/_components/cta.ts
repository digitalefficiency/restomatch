import { leakCheck as lc } from '@restomatch/api';
import { contactChannels, whatsappHref } from '@/lib/contact';

/**
 * The public free-leak-check page (S15) is env-gated: LEAK_CHECK_PUBLIC=1, and
 * the FEATURES_OFF kill-switch (leakCheck / all) wins — the same check the
 * pages and APIs use, so no CTA ever links to a 404. Read at request time on
 * the server, so flipping the env needs no rebuild.
 */
export function leakCheckPublic(): boolean {
  return lc.leakCheckPublicEnabled();
}

/**
 * The ONE primary destination behind "בדיקת דליפה חינם" (W1-12 · mkt-04): the
 * self-serve leak check when it is live, otherwise the lead form on the home page.
 */
export function primaryCtaHref(): string {
  return leakCheckPublic() ? '/leak-check' : '/#lead';
}

/** WhatsApp click-to-chat with a prefilled message, or null when no number is configured. */
export function whatsappLink(text: string): string | null {
  const wa = contactChannels().whatsapp;
  return wa ? whatsappHref(wa.digits, text) : null;
}
