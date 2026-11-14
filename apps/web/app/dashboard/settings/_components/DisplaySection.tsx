'use client';

import { Kbd, SegmentedControl, Switch, useAnnounce } from '@/lib/components';
import { keyLabel } from '@/lib/hotkeys';
import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { settings } from '@/lib/i18n/messages/settings';
import { useIsApple, usePrefs, type Density, type TextSize } from '@/lib/prefs';
import { SectionFoot, SettingControlRow, SettingRow, SettingsRows } from './ui';
import { useShellRail } from './useShellRail';

/** Forced colours: the selected option keeps a visible mark (SegmentedControl draws it with a fill only). */
const SEGMENT_FORCED = 'forced-colors:[&_[aria-checked=true]]:outline forced-colors:[&_[aria-checked=true]]:outline-2 forced-colors:[&_[aria-checked=true]]:outline-[Highlight]';
/** 44 px targets on a touch screen. */
const SEGMENT_TOUCH = '[@media(pointer:coarse)]:[&_button]:min-h-11';

/**
 * תצוגה (SPEC §10.5): personal, per device, acts at once, no Save button.
 * Density "רגיל / צפוף" (D4; the role's default until a choice is made), text
 * size, the side menu and single-key shortcuts. A setting that does nothing on
 * this device is absent (CSS, from the first HTML): density on a touch screen
 * (it is fixed there, SPEC §7), the side menu below 1024 px, the shortcuts on
 * a phone.
 */
export function DisplaySection({ initialRail }: { initialRail: boolean }) {
  const t = useT(settings);
  const tc = useT(components);
  const announce = useAnnounce();
  const p = usePrefs();
  const apple = useIsApple();
  const shell = useShellRail(initialRail);
  const mod = keyLabel('Mod', apple);

  const said = (what: string, value: string) => announce(t('display.sr.saved', { what: `${what}, ${value}` }));

  const densityOptions: Array<{ value: Density; label: string }> = [
    { value: 'regular', label: t('display.regular') },
    { value: 'compact', label: t('display.compact') },
  ];
  const textOptions: Array<{ value: TextSize; label: string }> = [
    { value: 'regular', label: t('display.textRegular') },
    { value: 'large', label: t('display.textLarge') },
  ];
  const railOptions: Array<{ value: 'full' | 'rail'; label: string }> = [
    { value: 'full', label: t('display.railFull') },
    { value: 'rail', label: t('display.railCollapsed') },
  ];

  const toggleKeys = (on: boolean) => {
    p.setSingleKeys(on);
    said(t('display.keysTitle'), on ? tc('ds.switch.on') : tc('ds.switch.off'));
  };

  return (
    <>
      <SettingsRows>
        <SettingRow
          id="density"
          absentOn="coarse"
          label={t('display.densityTitle')}
          hint={t('display.densityHint')}
          control={
            <SegmentedControl
              label={t('display.densityTitle')}
              value={p.density}
              options={densityOptions}
              className={SEGMENT_FORCED}
              onChange={(v) => {
                p.setDensity(v);
                said(t('display.densityTitle'), densityOptions.find((o) => o.value === v)!.label);
              }}
            />
          }
        />
        <SettingRow
          id="text"
          label={t('display.textTitle')}
          hint={t('display.textHint')}
          control={
            <SegmentedControl
              label={t('display.textTitle')}
              value={p.textSize}
              options={textOptions}
              className={`${SEGMENT_TOUCH} ${SEGMENT_FORCED}`}
              onChange={(v) => {
                p.setTextSize(v);
                said(t('display.textTitle'), textOptions.find((o) => o.value === v)!.label);
              }}
            />
          }
        />
        {shell.available ? (
          <SettingRow
            id="rail"
            absentOn="narrow"
            label={t('display.railTitle')}
            hint={t('display.railHint')}
            control={
              <>
                <SegmentedControl
                  label={t('display.railTitle')}
                  value={shell.rail ? 'rail' : 'full'}
                  options={railOptions}
                  className={SEGMENT_FORCED}
                  onChange={(v) => {
                    shell.setRail(v === 'rail');
                    said(t('display.railTitle'), railOptions.find((o) => o.value === v)!.label);
                  }}
                />
                <Kbd>{`${mod} B`}</Kbd>
              </>
            }
          />
        ) : null}
        {/* The shared switch: the whole row is its target (reference `.set-row[data-row="keys"]`). */}
        <SettingControlRow id="keys" absentOn="phone">
          <Switch
            checked={p.singleKeys}
            onCheckedChange={toggleKeys}
            label={t('display.keysTitle')}
            hint={
              <span className="inline-flex flex-wrap items-center gap-1">
                {/* Key caps are decorative (shared Kbd): the keys are said once, in words. */}
                <span className="sr-only">J, K, 1, 2, Z</span>
                <Kbd>J</Kbd> <Kbd>K</Kbd> <Kbd>1</Kbd> <Kbd>2</Kbd> <Kbd>Z</Kbd> {t('display.keysQueue')},{' '}
                <span className="sr-only">/</span>
                <Kbd>/</Kbd> {t('display.keysSearch')}
              </span>
            }
          />
        </SettingControlRow>
      </SettingsRows>
      <SectionFoot>
        <span className="[@media(max-width:1023.98px)_and_(pointer:coarse)]:hidden">{t('display.ctrlNote', { mod })}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            p.reset();
            // The reference's reset also expands the side menu (script.js "reset").
            if (shell.rail) shell.setRail(false);
            announce(t('display.sr.resetDone'));
          }}
          className="inline-flex min-h-6 items-center font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary [@media(pointer:coarse)]:min-h-11"
        >
          {t('display.reset')}
        </button>
      </SectionFoot>
    </>
  );
}
