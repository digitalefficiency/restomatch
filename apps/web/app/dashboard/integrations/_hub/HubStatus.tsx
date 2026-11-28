import Link from 'next/link';
import { Badge, type BadgeTone } from '@/lib/components';
import { contactChannels, whatsappHref } from '@/lib/contact';
import { formatDate } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { integrations as integrationsNs } from '@/lib/i18n/messages/integrations';
import type { MessageKey } from '@/lib/i18n/translate';
import { groupTiles, toneOf, type HubStatus, type HubTile } from './hub';

type IntegrationsKey = MessageKey<typeof integrationsNs.he>;

/** A tile plus where its one action goes. */
export interface HubTileView extends HubTile {
  href?: string;
  /** Extra neutral line (e.g. active intake channels). */
  detail?: string;
}

const TONE: Record<'T2' | 'T3' | 'T4', BadgeTone> = { T2: 'warning-solid', T3: 'accent', T4: 'neutral' };

/**
 * W3-07a · the "חיבורים" status board: four fixed groups, a chip per
 * connection, last sync, one action. "Not connected" is neutral (T4).
 */
export async function HubStatusBoard({ tiles }: { tiles: HubTileView[] }) {
  const [t, locale] = await Promise.all([getT(integrationsNs), getLocale()]);
  const contact = contactChannels();
  const groups = groupTiles(tiles) as { group: HubTile['group']; tiles: HubTileView[] }[];

  const contactHref = (platform: string): string | null => {
    const text = t('hub.contactText', { platform });
    if (contact.whatsapp) return whatsappHref(contact.whatsapp.digits, text);
    if (contact.email) return `${contact.email.href}?subject=${encodeURIComponent(text)}`;
    return null;
  };

  return (
    <section aria-labelledby="hub-title" data-testid="hub-status">
      <h2 id="hub-title" className="text-lg font-semibold text-ink">
        {t('hub.title')}
      </h2>
      <p className="mb-4 text-sm text-muted">{t('hub.subtitle')}</p>
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map(({ group, tiles: list }) => (
          <div key={group} className="rounded-xl border border-line bg-surface p-4 shadow-card" data-group={group}>
            <h3 className="mb-3 text-sm font-semibold text-subtle">{t(`hub.groups.${group}` as IntegrationsKey)}</h3>
            <ul className="space-y-3">
              {list.map((tile) => {
                const label = t(`hub.tiles.${tile.key}` as IntegrationsKey);
                const needsContact = tile.group === 'procurement' && tile.status !== 'connected';
                const contactLink = needsContact ? contactHref(label) : null;
                return (
                  <li key={tile.key} className="flex flex-wrap items-center justify-between gap-2" data-tile={tile.key} data-status={tile.status}>
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{label}</p>
                      <p className="text-xs text-muted">
                        {tile.lastSyncAt ? t('hub.lastSync', { when: formatDate(tile.lastSyncAt, locale) }) : t('hub.never')}
                        {tile.detail ? ` · ${tile.detail}` : ''}
                      </p>
                      {tile.errorKey ? <p className="text-xs text-danger">{t(tile.errorKey as IntegrationsKey)}</p> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={TONE[toneOf(tile.status)]}>{t(`hub.status.${tile.status as HubStatus}` as IntegrationsKey)}</Badge>
                      {contactLink ? (
                        <a href={contactLink} className="text-xs font-semibold text-primary underline" rel="noopener noreferrer" target="_blank">
                          {t('hub.cta.contact')}
                        </a>
                      ) : tile.href ? (
                        <Link href={tile.href} className="text-xs font-semibold text-primary underline">
                          {tile.key === 'intake' ? t('hub.cta.intake') : t('hub.cta.setUp')}
                        </Link>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
