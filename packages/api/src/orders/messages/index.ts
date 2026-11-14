import { ordersAutopilotEn } from './en';
import { ordersAutopilotHe } from './he';

export { ordersAutopilotEn, ordersAutopilotHe };

export function ordersAutopilotMessages(locale: 'he' | 'en' = 'he') {
  return locale === 'en' ? ordersAutopilotEn : ordersAutopilotHe;
}
