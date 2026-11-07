/**
 * AU-04 role briefs: the shared shapes. Every builder in this folder is PURE: it
 * takes plain data (already gathered and restaurant-scoped by the job) and returns
 * one rendered message, or `null` when there is nothing worth saying. No DB, no
 * clock, no environment. The jobs gather data and hand the result to G-06 `notify()`.
 */
export type BriefLocale = 'he' | 'en';

export interface BriefMessage {
  subject: string;
  text: string;
  html: string;
  /** The single go-link the message points to (`/dashboard/go?r=&to=`). */
  deepLink: string;
  /**
   * The tail of the dedupe key after `au:<A-id>:<restaurantId>:<recipientId>:` —
   * the IL day or the entity the message is about, so a second run the same slot
   * dedupes and a next-day run does not.
   */
  dedupeSuffix: string;
  /** The research-catalogue id (A3..A7), carried as `payload.automationId` (AU-07 KPI hook). */
  automationId: 'A3' | 'A4' | 'A5' | 'A6' | 'A7';
}

/** The common inputs every builder takes. */
export interface BriefContext {
  restaurantId: string;
  /** Public app base URL, no trailing slash. */
  baseUrl: string;
  locale?: BriefLocale;
}
