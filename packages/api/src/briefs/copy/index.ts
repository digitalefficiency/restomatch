import type { BriefLocale } from '../types';
import { en } from './en';
import { he } from './he';
import type { BriefCopy } from './types';

export type { BriefCopy } from './types';
export function briefCopy(locale: BriefLocale = 'he'): BriefCopy {
  return locale === 'en' ? en : he;
}
