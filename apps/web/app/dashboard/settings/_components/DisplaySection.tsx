'use client';

import { SegmentedControl, useAnnounce } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { settings } from '@/lib/i18n/messages/settings';
import { usePrefs, type Density, type TextSize } from '@/lib/prefs';
import { Switch } from './controls';
import { Kbd, SectionFoot, SettingRow, SettingsRows } from './ui';
import { useShellRail } from './useShellRail';

/**
 * תצוגה (SPEC §10.5): personal, per device, acts at once, no Save button.
 * Density "רגיל / צפוף" (D4; the role's default until a choice is made), text
 * size, the side menu and single-key shortcuts. On a phone density is fixed
 * (the row says so) and the side menu and the shortcuts are absent.
 */
export function DisplaySection({ initialRail }: { initialRail: boolean }) {
  const t = useT(settings);
  const announce = useAnnounce();
  const p = usePrefs();
  const shell = useShellRail(initialRail);

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
    said(t('display.keysTitle'), on ? t('display.on') : t('display.off'));
  };

  return (
    <>
      <SettingsRows>
        {/* Desk: the switch. Phone / touch: density is fixed, said in words (no control). */}
        <SettingRow
          id="density"
          label={t('display.densityTitle')}
          hint={
            <>
              <span className="hidden [@media(min-width:1024px)_and_(pointer:fine)]:inline">{t('display.densityHint')}</span>
              <span className="[@media(min-width:1024px)_and_(pointer:fine)]:hidden">{t('display.densityFixedHint')}</span>
            </>
          }
          control={
            <>
              <span className="hidden [@media(min-width:1024px)_and_(pointer:fine)]:inline">
                <SegmentedControl
                  label={t('display.densityTitle')}
                  value={p.density}
                  options={densityOptions}
                  onChange={(v) => {
                    p.setDensity(v);
                    said(t('display.densityTitle'), densityOptions.find((o) => o.value === v)!.label);
                  }}
                />
              </span>
              <span className="text-body-sm text-muted [@media(min-width:1024px)_and_(pointer:fine)]:hidden">{t('display.densityFixed')}</span>
            </>
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
              className="[@media(pointer:coarse)]:[&_button]:min-h-11"
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
            deskOnly
            label={t('display.railTitle')}
            hint={t('display.railHint')}
            control={
              <>
                <SegmentedControl
                  label={t('display.railTitle')}
                  value={shell.rail ? 'rail' : 'full'}
                  options={railOptions}
                  onChange={(v) => {
                    shell.setRail(v === 'rail');
                    said(t('display.railTitle'), railOptions.find((o) => o.value === v)!.label);
                  }}
                />
                <Kbd>Ctrl B</Kbd>
              </>
            }
          />
        ) : null}
        <SettingRow
            id="keys"
            deskOnly
            className="cursor-pointer"
            onClick={(e) => {
              // The whole row is the switch's target (reference `.set-row[data-row="keys"]`).
              if ((e.target as HTMLElement).closest('button')) return;
              toggleKeys(!p.singleKeys);
            }}
            label={t('display.keysTitle')}
            hint={
              <span className="inline-flex flex-wrap items-center gap-1">
                <Kbd>J</Kbd> <Kbd>K</Kbd> <Kbd>1</Kbd> <Kbd>2</Kbd> <Kbd>Z</Kbd> {t('display.keysQueue')},{' '}
                <Kbd>/</Kbd> {t('display.keysSearch')}
              </span>
            }
            control={
              <>
                <Switch checked={p.singleKeys} onChange={toggleKeys} label={t('display.keysTitle')} />
                <span aria-hidden="true" className="min-w-8 text-body-sm text-muted">
                  {p.singleKeys ? t('display.on') : t('display.off')}
                </span>
              </>
            }
          />
      </SettingsRows>
      <SectionFoot>
        <span className="hidden lg:inline">{t('display.ctrlNote')}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            p.reset();
            if (shell.rail) shell.setRail(false);
            announce(t('display.sr.resetDone'));
          }}
          className="inline-flex min-h-11 items-center font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary lg:min-h-6"
        >
          {t('display.reset')}
        </button>
      </SectionFoot>
    </>
  );
}
