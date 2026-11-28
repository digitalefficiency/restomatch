/**
 * W3-03b · the one source of the app manifest: `public/pwa/manifest.webmanifest`
 * is MANIFEST_BASE exactly (the worker precaches it; it serves signed-out and
 * offline, and it is the same for every user, so it is safe in shared caches).
 *
 * - `scope` is `/dashboard` with no trailing slash: prefix matching then covers
 *   `/dashboard` and `/dashboard/*`. Next redirects `/dashboard/` → `/dashboard`
 *   (308, no trailingSlash config), so a `/dashboard/` scope would leave the
 *   launch page itself outside the app.
 * - `start_url` is `/dashboard?source=pwa`, a 200 inside that scope.
 * - No `shortcuts`: installed shortcuts belong to the device, not the user, so
 *   on a shared phone they would offer the next user the installer's screens
 *   (a 403 or a flag-off 404). Revisit with role-neutral targets only.
 */
export const MANIFEST_BASE = {
  id: '/dashboard/receiving',
  name: 'RestoMatch',
  short_name: 'RestoMatch',
  description: 'RestoMatch: receiving, counts, orders and approvals on the phone, even offline.',
  lang: 'he',
  dir: 'rtl',
  start_url: '/dashboard?source=pwa',
  scope: '/dashboard',
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

