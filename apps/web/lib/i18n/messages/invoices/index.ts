import { defineMessages } from '../../translate';
import { decideEn, decideHe } from './decide';
import { en } from './en';
import { gapEn, gapHe } from './gap';
import { he } from './he';
import { listEn, listHe } from './list';
import { screenEn, screenHe } from './screen';

// The invoices area's own groups (INV batch, seam S3), each file holding both languages:
// `gap.*` the words every screen shares (INV-00), `screen.*` the invoice screen (INV-01),
// `list.*` the invoices list (INV-02), `decide.*` deciding from the invoice screen (INV-05).
export const invoices = defineMessages(
  'invoices',
  { ...he, gap: gapHe, screen: screenHe, list: listHe, decide: decideHe },
  { ...en, gap: gapEn, screen: screenEn, list: listEn, decide: decideEn },
);
