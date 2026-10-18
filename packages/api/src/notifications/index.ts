export * from './types';
export { DEDUPE_INDEX_PREDICATE, enqueueNotification, markSent, markFailed } from './outbox';
export { MockWhatsAppNotifier } from './whatsapp';
export { WhatsAppCloudNotifier, type WhatsAppCloudConfig } from './whatsappCloud';
export { MockPushNotifier } from './push';
export { EmailNotifier } from './email';
export { makeResendDispatcher, ResendEmailNotifier, type ResendConfig } from './resend';
export {
  renderEmail,
  ilsSpan,
  magicLinkEmail,
  passwordResetEmail,
  inviteEmail,
  supplierDelayEmail,
  orderNotPlacedEmail,
  approvalNeededEmail,
  weeklyLeakReportEmail,
  endOfDayReportEmail,
  type RenderedEmail,
  type EmailLocale,
  type EmailLayout,
} from './templates';
export {
  recipientsForRestaurant,
  MANAGER_ROLES,
  type Recipient,
} from './recipients';
export {
  createNotifiers,
  createEmailNotifier,
  createWhatsAppNotifier,
  createPushNotifier,
  isResendConfigured,
  isWhatsAppCloudConfigured,
  type Notifiers,
  type NotifierFactoryEnv,
} from './factory';
