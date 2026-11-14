import { DEFAULT_APPROVAL_THRESHOLDS } from '@restomatch/api';
import { DEFAULT_TOLERANCES } from '@restomatch/matching';
import { DEFAULT_REVIEW_THRESHOLD } from '@restomatch/ocr';
import { getT } from '@/lib/i18n/server';
import { settings as settingsMessages } from '@/lib/i18n/messages/settings';
import { createServerCaller } from '@/lib/trpc/server';
import { SectionForbidden } from '../_components/misc';
import { SectionHead } from '../_components/ui';
import { settingsViewer } from '../_lib/viewer';
import { RulesForm } from '../_rules/RulesForm';
import type { Defaults, StoredKnobs } from '../_rules/model';

/** The engines' own defaults (never redefined here): what "ברירת מחדל" means for each field. */
const DEFAULTS: Defaults = {
  ...DEFAULT_TOLERANCES,
  ...DEFAULT_APPROVAL_THRESHOLDS,
  ocrReviewThreshold: DEFAULT_REVIEW_THRESHOLD,
};

/**
 * כללי התאמה ואישור — the matching tolerances, the approval thresholds and the
 * OCR review threshold. Owner edits (settings.update, unchanged); manager and
 * bookkeeper read, with the history; receiver and chef never see it.
 */
export async function RulesSettings() {
  const [t, viewer] = await Promise.all([getT(settingsMessages), settingsViewer()]);
  if (!viewer.seesRestaurant) return <SectionForbidden screen={t('areas.rules.title')} />;
  const caller = await createServerCaller();
  const [stored, history] = await Promise.all([caller.settings.get(), caller.settings.history({ limit: 100 })]);
  const knobs: StoredKnobs = {
    tolerances: stored.tolerances,
    approvalThresholds: stored.approvalThresholds,
    ocrReviewThreshold: stored.ocrReviewThreshold ?? null,
  };
  return (
    <section aria-labelledby="settings-rules">
      <SectionHead
        title={<span id="settings-rules">{t('areas.rules.title')}</span>}
        subtitle={t('areas.rules.subtitle')}
        scope="restaurant"
        scopeLabel={t('scope.restaurant')}
      />
      <RulesForm initial={knobs} defaults={DEFAULTS} history={history} canEdit={viewer.isOwner} />
    </section>
  );
}
