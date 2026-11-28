import type { UserRole } from '@restomatch/db';
import { canFollowPath } from '@/lib/nav/visibility';

/**
 * W3-03b · the one source of the app manifest.
 * - `public/pwa/manifest.webmanifest` is MANIFEST_BASE exactly (no shortcuts):
 *   the worker precaches it and it serves signed-out and offline.
 * - `/dashboard/share/manifest` (the one the app links, with credentials) adds
 *   only the shortcuts THIS viewer can open (role gate + flags, `canFollowPath`),
 *   so nobody is offered a 403 or a money screen they may not see.
 * `start_url` sits inside `scope` (the spec drops a scope that does not contain it).
 */
export const MANIFEST_BASE = {
  id: '/dashboard/receiving',
  name: 'RestoMatch',
  short_name: 'RestoMatch',
  description: 'RestoMatch: receiving, counts, orders and approvals on the phone, even offline.',
  lang: 'he',
  dir: 'rtl',
  start_url: '/dashboard/?source=pwa',
  scope: '/dashboard/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#F6F8F7',
  theme_color: '#F6F8F7',
  categories: ['business', 'productivity'],
  share_target: {
    action: '/dashboard/share/receive',
    method: 'POST',
    enctype: 'multipart/form-data',
    params: {
      title: 'title',
      text: 'text',
      url: 'url',
      files: [{ name: 'files', accept: ['image/*', 'application/pdf'] }],
    },
  },
  icons: [
    { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
} as const;

const icon = [{ src: '/pwa/icon-192.png', sizes: '192x192' }];
/** The field shortcuts, in this order; each is offered only to viewers who can open it. */
export const SHORTCUTS = [
  { name: 'קבלת משלוח', short_name: 'קבלה', url: '/dashboard/receiving?source=pwa', icons: icon },
  { name: 'ספירה', short_name: 'ספירה', url: '/dashboard/inventory/count?source=pwa', icons: icon },
  { name: 'הזמנה חדשה', short_name: 'הזמנה', url: '/dashboard/orders/new?source=pwa', icons: icon },
  { name: 'אישורים', short_name: 'אישורים', url: '/dashboard/approvals?source=pwa', icons: icon },
] as const;

export interface ManifestViewer {
  role: UserRole;
  features: readonly string[];
}

export function manifestFor(viewer: ManifestViewer | null) {
  const shortcuts = viewer ? SHORTCUTS.filter((s) => canFollowPath(viewer, s.url.split('?')[0]!)) : [];
  return shortcuts.length > 0 ? { ...MANIFEST_BASE, shortcuts } : { ...MANIFEST_BASE };
}
