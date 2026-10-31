import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { authenticator } from 'otplib';
import { e2eSql, ensurePasswordUser, loginViaMagicLink } from './helpers';
import { DEMO_RESTAURANT_NAME } from './env';

/**
 * W1-09 · sign-in and supplier portal. The two P0s first (reproduced failing on
 * main before the fix: the queue came back [] and the shortage was stored as
 * "confirmed"), then the acceptance flows, then axe + the ₪-left check on every
 * touched route at phone 390 and desktop 1440, in Hebrew and English.
 */
const PASSWORD = 'E2e-Correct-Horse-9!';
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const BASE = () => test.info().project.use.baseURL ?? 'http://localhost:3100';

async function setLocale(page: Page, locale: 'he' | 'en') {
  await page.context().addCookies([
    { name: 'rm_locale', value: locale, url: BASE() },
    { name: 'rm_cookie_consent', value: 'necessary', url: BASE() },
  ]);
}

/** Seed one queued receiver photo straight into the PWA queue (IndexedDB) of this origin. */
async function seedQueuedPhoto(page: Page, id: string) {
  await page.evaluate(
    (clientUploadId) =>
      new Promise<void>((resolve, reject) => {
        // W2-05: the photo queue lives in the field outbox (key photo:<clientUploadId>).
        const req = indexedDB.open('restomatch-outbox', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('items', { keyPath: 'key' });
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const t = db.transaction('items', 'readwrite');
          const createdAt = Date.now();
          t.objectStore('items').put({
            key: `photo:${clientUploadId}`,
            kind: 'photo',
            group: null,
            payload: {
              clientUploadId,
              restaurantId: 'r',
              userId: 'u',
              poId: 'p',
              supplierId: 's',
              supplierName: 'ספק',
              mimeType: 'image/jpeg',
              blob: new Blob(['x'], { type: 'image/jpeg' }),
              createdAt,
              attempts: 0,
              lastError: null,
            },
            restaurantId: 'r',
            userId: 'u',
            capturedByName: null,
            createdAt,
            revision: 1,
            attempts: 0,
            nextAttemptAt: createdAt,
            lastError: null,
            status: 'pending',
            warnedAt: null,
          });
          t.oncomplete = () => {
            db.close();
            resolve();
          };
          t.onerror = () => reject(t.error);
        };
      }),
    id,
  );
}

async function queuedIds(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const req = indexedDB.open('restomatch-outbox', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('items', { keyPath: 'key' });
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const r = db.transaction('items', 'readonly').objectStore('items').getAllKeys();
          r.onsuccess = () => {
            db.close();
            resolve(
              r.result
                .map(String)
                .filter((k) => k.startsWith('photo:'))
                .map((k) => k.slice('photo:'.length)),
            );
          };
        };
      }),
  );
}


test.describe('auth-01 · the offline photo queue survives /login', () => {
  test.use(PHONE);

  test('a queued invoice photo is still on the device after /login, and the page says so', async ({ page }) => {
    await page.context().clearCookies();
    await setLocale(page, 'he');
    await page.goto('/reset');
    await seedQueuedPhoto(page, 'w109-photo-1');
    await page.goto('/login');
    await expect(page.getByTestId('queued-photos-note')).toContainText('צילום חשבונית אחד ממתין במכשיר');
    await page.waitForTimeout(500);
    expect(await queuedIds(page)).toContain('w109-photo-1');
    // A second visit (e.g. after another expired session) still keeps it.
    await page.reload();
    await expect(page.getByTestId('queued-photos-note')).toBeVisible();
    expect(await queuedIds(page)).toContain('w109-photo-1');
  });
});

test.describe('login', () => {
  const email = 'e2e-w109@restomatch.test';
  test.beforeAll(async () => {
    await ensurePasswordUser({ email, password: PASSWORD });
  });

  test('one email field; a wrong password keeps it, focuses the password, then offers the email link', async ({ page }) => {
    await setLocale(page, 'he');
    await page.goto('/login');
    await expect(page.locator('input[name="email"]')).toHaveCount(1);
    const submit = page.getByRole('button', { name: 'כניסה', exact: true });
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(`wrong-${attempt}`);
      await submit.click();
      await expect(page).toHaveURL(/error=CredentialsSignin/);
      await expect(page.locator('input[name="email"]')).toHaveValue(email);
      await expect(page.locator('input[name="password"]')).toBeFocused();
      // The URL never carries the typed address.
      expect(page.url()).not.toContain('e2e-w109');
    }
    await expect(page.getByTestId('magic-fallback')).toBeVisible();
    // Enter in the password field always tries the PASSWORD — never the email-link fallback
    // (review #2). Other specs (demo-path, i18n-sweep) rely on ONE submit inside the form.
    await expect(page.locator('form:has(#password) button[type="submit"]')).toHaveCount(1);
    await page.locator('input[name="password"]').fill('wrong-3');
    await page.locator('input[name="password"]').press('Enter');
    await expect(page).toHaveURL(/error=CredentialsSignin/);
    await expect(page).not.toHaveURL(/check-email/);
    // "שכחתם?" sits on the password label row at 14 px; the eye toggle is 44 px.
    const forgot = page.getByRole('link', { name: 'שכחתם?' });
    expect(await forgot.evaluate((el) => getComputedStyle(el).fontSize)).toBe('14px');
    const eye = page.getByRole('button', { name: 'הצגת הסיסמה' });
    const box = (await eye.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await eye.click();
    await expect(page.locator('input[name="password"]')).toHaveAttribute('type', 'text');
    await expect(eye.or(page.getByRole('button', { name: 'הסתרת הסיסמה' }))).toHaveAttribute('aria-pressed', 'true');
  });

  test('the email-link button uses the same field → check-email names the masked address with a 30 s resend', async ({ page }) => {
    await setLocale(page, 'he');
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(email);
    await page.getByRole('button', { name: 'שלחו לי קישור כניסה למייל' }).click();
    await expect(page).toHaveURL(/\/login\/check-email/);
    await expect(page.getByTestId('check-email-body')).toContainText('e2•••@restomatch.test');
    await expect(page.getByTestId('resend')).toBeDisabled();
    await expect(page.getByTestId('resend')).toContainText(/שליחה חוזרת בעוד \d+ שניות/);
    await expect(page.getByRole('link', { name: 'פתיחת Gmail' })).toBeVisible();
    await expect(page.getByText('בדקו בתיקיית הספאם')).toBeVisible();
  });

  test('a signed-in user with a callbackUrl skips the form', async ({ page }) => {
    await setLocale(page, 'he');
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'כניסה', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/login?callbackUrl=%2Fdashboard%2Forders');
    await expect(page).toHaveURL(/\/dashboard\/orders/);
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'המשך לחשבון' })).toBeVisible();
  });
});

test.describe('auth-08 · 2FA recovery code on a phone', () => {
  test.use(PHONE);
  const email = 'e2e-w109-2fa@restomatch.test';
  const secret = authenticator.generateSecret();
  const code = 'abcde-fgh23';

  test.beforeAll(async () => {
    await ensurePasswordUser({ email, password: PASSWORD, totpSecret: secret });
    const sql = e2eSql();
    try {
      const [u] = await sql<{ id: string }[]>`select id from users where email = ${email}`;
      await sql`delete from user_recovery_codes where user_id = ${u!.id}`;
      const hash = createHash('sha256').update('abcdefgh23').digest('hex');
      await sql`insert into user_recovery_codes (user_id, code_hash) values (${u!.id}, ${hash})`;
    } finally {
      await sql.end();
    }
  });

  test('switch to recovery mode → a text keyboard, letters accepted → dashboard', async ({ page }) => {
    await setLocale(page, 'he');
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'כניסה', exact: true }).click();
    await expect(page.locator('input[name="code"]')).toHaveAttribute('inputmode', 'numeric');
    await page.getByTestId('twofa-mode-toggle').click();
    const input = page.locator('input[name="code"]');
    await expect(input).toHaveAttribute('inputmode', 'text');
    await expect(input).toHaveAttribute('autocapitalize', 'off');
    await expect(input).toHaveAttribute('spellcheck', 'false');
    await input.fill(code.toUpperCase());
    await page.getByRole('button', { name: 'אימות' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

test.describe('auth-09 · onboarding honours callbackUrl', () => {
  const email = `e2e-w109-new-${Date.now()}@restomatch.test`;
  test.afterAll(async () => {
    const sql = e2eSql();
    try {
      await sql`delete from restaurants where id in (
        select restaurant_id from memberships m join users u on u.id = m.user_id where u.email = ${email})`;
      await sql`delete from users where email = ${email}`;
    } finally {
      await sql.end();
    }
  });

  test('claim → onboarding → back to the claim, with the signer name stored', async ({ page }) => {
    await setLocale(page, 'he');
    const claim = '/leak-check/claim?t=w109-token';
    await loginViaMagicLink(page, email, `/onboarding?callbackUrl=${encodeURIComponent(claim)}`);
    await expect(page).toHaveURL(/\/onboarding\?callbackUrl=/);
    // noValidate + inline errors: submitting empty shows our own messages and focuses the first field.
    await page.getByRole('button', { name: 'יצירת מסעדה והמשך' }).click();
    await expect(page.locator('#yourName')).toBeFocused();
    await expect(page.locator('#yourName')).toHaveAttribute('aria-invalid', 'true');
    await page.locator('#yourName').fill('דנה בדיקה');
    await page.locator('#name').fill('מסעדת W109');
    await page.locator('#businessId').fill('51-477812-3');
    await page.getByRole('button', { name: 'יצירת מסעדה והמשך' }).click();
    // The public leak check is env-gated (LEAK_CHECK_PUBLIC) and 404s in e2e;
    // what matters here is that the claim URL — not /dashboard — is where we land.
    await expect(page).toHaveURL(/\/leak-check\/claim\?t=w109-token/);
    const sql = e2eSql();
    try {
      const [row] = await sql<{ name: string | null; biz: string | null }[]>`
        select u.name, r.business_id as biz from users u
        join memberships m on m.user_id = u.id join restaurants r on r.id = m.restaurant_id
        where u.email = ${email}`;
      expect(row).toEqual({ name: 'דנה בדיקה', biz: '514778123' });
    } finally {
      await sql.end();
    }
  });
});

test.describe('auth-11 · invite errors are calm and specific', () => {
  const email = 'e2e-w109-invitee@restomatch.test';
  const token = randomBytes(24).toString('base64url');
  test.beforeAll(async () => {
    await ensurePasswordUser({ email, password: PASSWORD });
    const sql = e2eSql();
    try {
      const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
      await sql`delete from invitations where email = 'someone-else@restomatch.test'`;
      await sql`
        insert into invitations (restaurant_id, email, role, token_hash, expires_at)
        values (${r!.id}, 'someone-else@restomatch.test', 'receiver',
                ${createHash('sha256').update(token).digest('hex')}, now() + interval '7 days')`;
    } finally {
      await sql.end();
    }
  });

  test('wrong email → names both addresses and offers sign-out-and-switch', async ({ page }) => {
    await setLocale(page, 'he');
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'כניסה', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto(`/invite/accept?token=${token}`);
    await expect(page.getByTestId('invite-state')).toHaveAttribute('data-state', 'wrongEmail');
    await expect(page.getByTestId('invite-state')).toContainText('someone-else@restomatch.test');
    await expect(page.getByRole('button', { name: 'התנתקות וכניסה עם someone-else@restomatch.test' })).toBeVisible();
    await expect(page.locator('h1')).not.toHaveClass(/text-danger/);
  });

  test('an expired invite reads EXPIRED on every open, not "already used" (review #3)', async ({ page }) => {
    const expiredToken = randomBytes(24).toString('base64url');
    const sql = e2eSql();
    try {
      const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
      await sql`delete from invitations where email = ${email}`;
      await sql`
        insert into invitations (restaurant_id, email, role, token_hash, expires_at, created_at)
        values (${r!.id}, ${email}, 'receiver', ${createHash('sha256').update(expiredToken).digest('hex')},
                now() - interval '1 day', now() - interval '8 days')`;
    } finally {
      await sql.end();
    }
    await setLocale(page, 'he');
    await page.goto('/login');
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'כניסה', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    for (let open = 1; open <= 2; open += 1) {
      await page.goto(`/invite/accept?token=${expiredToken}`);
      await expect(page.getByTestId('invite-state')).toHaveAttribute('data-state', 'expired');
    }
  });

  test('an unknown invite never links a member-less user to /dashboard', async ({ page }) => {
    const lone = `e2e-w109-lone-${Date.now()}@restomatch.test`;
    await loginViaMagicLink(page, lone, '/invite/accept?token=nope');
    await expect(page.getByTestId('invite-state')).toHaveAttribute('data-state', 'notFound');
    await expect(page.locator('main a[href="/dashboard"]')).toHaveCount(0);
    const sql = e2eSql();
    await sql`delete from users where email = ${lone}`.finally(() => sql.end());
  });
});
/** A fresh 72h supplier link for a sent demo order with ≥2 lines and no answer yet. */
async function freshSupplierLink(): Promise<{ token: string; poId: string; lineIds: string[] }> {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    await sql`update restaurants set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{features,supplierConfirm}', 'true'::jsonb, true) where id = ${r!.id}`;
    const [po] = await sql<{ id: string }[]>`
      select po.id from purchase_orders po
      where po.restaurant_id = ${r!.id} and po.status in ('sent','confirmed','partial')
        and (select count(*) from po_lines l where l.po_id = po.id) >= 2
      order by po.created_at desc limit 1`;
    if (!po) throw new Error('no confirmable demo order');
    await sql`delete from supplier_responses where po_id = ${po.id}`;
    const token = randomBytes(32).toString('base64url');
    await sql`
      insert into supplier_confirm_links (restaurant_id, po_id, token_hash, expires_at)
      values (${r!.id}, ${po.id}, ${createHash('sha256').update(token, 'utf8').digest('hex')}, now() + interval '72 hours')`;
    const lines = await sql<{ id: string }[]>`select id from po_lines where po_id = ${po.id} order by id`;
    return { token, poId: po.id, lineIds: lines.map((l) => l.id) };
  } finally {
    await sql.end();
  }
}

async function storedResponse(poId: string) {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ status: string; lines: Array<{ poLineId: string; qtyAvailable: number | null }> }[]>`
      select status, lines from supplier_responses where po_id = ${poId}`;
    return row ?? null;
  } finally {
    await sql.end();
  }
}


async function storedLines(poId: string) {
  return (await storedResponse(poId))?.lines ?? [];
}

/** ₪ glyph left of the first digit (DoD-4), for every amount in `scope` that has one. */
async function shekelLeftOfDigits(scope: Locator): Promise<string[]> {
  return scope.evaluateAll((els) => {
    const bad: string[] = [];
    for (const el of els) {
      const text = el.textContent ?? '';
      const shekel = text.indexOf('₪');
      const digit = text.search(/\d/);
      if (shekel < 0 || digit < 0) continue;
      const node = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes('₪'));
      if (!node) continue;
      const r = document.createRange();
      r.setStart(node, (node.textContent ?? '').indexOf('₪'));
      r.setEnd(node, (node.textContent ?? '').indexOf('₪') + 1);
      const s = r.getBoundingClientRect();
      const di = (node.textContent ?? '').search(/\d/);
      r.setStart(node, di);
      r.setEnd(node, di + 1);
      const d = r.getBoundingClientRect();
      if (!(s.right <= d.left + 0.5)) bad.push(text);
      if (el.closest('[dir="ltr"]')) bad.push(`dir=ltr around ${text}`);
    }
    return bad;
  });
}

test.describe('auth-02/03/14/16 · supplier portal', () => {
  test.use(PHONE);

  test('a marked shortage is carried by the ONE primary and restated on the done card', async ({ page }) => {
    const { token, poId, lineIds } = await freshSupplierLink();
    await setLocale(page, 'he');
    await page.goto(`/s/${token}`);
    const primary = page.locator('[data-primary]');
    await expect(primary).toHaveText('אישור ההזמנה כפי שהיא');
    await page.locator(`#qty-${lineIds[0]}`).fill('0.5');
    await expect(primary).toHaveText('שליחת התשובה · שינוי אחד');
    await expect(page.getByTestId('portal-diff')).toContainText('חוסר');
    await primary.click();
    await expect(page.getByTestId('portal-done')).toContainText('חוסר');
    const resp = await storedResponse(poId);
    expect(resp?.status).toBe('changes');
    expect((await storedLines(poId)).find((l) => l.poLineId === lineIds[0])?.qtyAvailable).toBe(0.5);
    // A plain revisit of the link (no 409) restates the recorded answer, not just "already answered".
    await page.reload();
    await expect(page.getByTestId('portal-answered')).toContainText('התשובה שנרשמה');
    await expect(page.getByTestId('portal-answered')).toContainText('חוסר');
    await expect(page.getByTestId('portal-answered')).not.toContainText('לא נשמרו');
  });

  test('"as ordered" with edits asks to discard them first; "out of stock" is one tap', async ({ page }) => {
    const { token, poId, lineIds } = await freshSupplierLink();
    await setLocale(page, 'he');
    await page.goto(`/s/${token}`);
    await page.getByRole('button', { name: 'אין במלאי' }).first().click();
    await expect(page.locator(`#qty-${lineIds[0]}`)).toHaveValue('0');
    await page.locator(`#price-${lineIds[1]}`).fill('99.5');
    await expect(page.locator('[data-primary]')).toHaveText('שליחת התשובה · 2 שינויים');
    await page.getByRole('button', { name: 'אישור כפי שהוזמן' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('לבטל 2 שינויים ולאשר כפי שהוזמן?');
    await page.getByRole('button', { name: 'חזרה לשינויים' }).click();
    // Cancelling the question returns focus to the button that opened it (review #10).
    await expect(page.getByRole('button', { name: 'אישור כפי שהוזמן' })).toBeFocused();
    await expect(page.locator(`#qty-${lineIds[0]}`)).toHaveValue('0');
    expect(await storedResponse(poId)).toBeNull();
    // The note is the supplier's own words: discarding line edits never drops it.
    await page.locator('#portal-note').fill('יגיע מחר בבוקר');
    await page.getByRole('button', { name: 'אישור כפי שהוזמן' }).click();
    await page.getByRole('button', { name: 'כן, לאשר כפי שהוזמן' }).click();
    await expect(page.getByTestId('portal-done')).toContainText('יגיע מחר בבוקר');
    const stored = await storedResponse(poId);
    expect(stored?.lines).toEqual([]);
    const sql = e2eSql();
    try {
      const [row] = await sql<{ note: string | null }[]>`select note from supplier_responses where po_id = ${poId}`;
      expect(row?.note).toBe('יגיע מחר בבוקר');
    } finally {
      await sql.end();
    }
  });

  test('409: a second answer shows the recorded one and its date — never a false success', async ({ page }) => {
    const { token, poId, lineIds } = await freshSupplierLink();
    await setLocale(page, 'he');
    await page.goto(`/s/${token}`);
    // Someone else at the supplier answers first.
    const sql = e2eSql();
    try {
      const [r] = await sql<{ restaurant_id: string; id: string }[]>`
        select restaurant_id, id from supplier_confirm_links where po_id = ${poId} order by created_at desc limit 1`;
      await sql`
        insert into supplier_responses (restaurant_id, po_id, link_id, status, lines, note, submitted_at)
        values (${r!.restaurant_id}, ${poId}, ${r!.id}, 'changes',
                ${sql.json([{ poLineId: lineIds[1]!, qtyAvailable: 0, proposedUnitPrice: null }])}, null, now())`;
    } finally {
      await sql.end();
    }
    await page.locator(`#qty-${lineIds[0]}`).fill('0.5');
    await page.locator('[data-primary]').click();
    await expect(page.getByTestId('portal-answered')).toContainText('השינויים שסימנתם עכשיו לא נשמרו');
    await expect(page.getByTestId('portal-answered')).toContainText('אין במלאי');
    await expect(page.getByTestId('portal-done')).toHaveCount(0);
  });

  test('money is plain tabular bdi with ₪ left of the digits; totals equal their lines', async ({ page }) => {
    const { token } = await freshSupplierLink();
    await setLocale(page, 'he');
    await page.goto(`/s/${token}`);
    await expect(page.getByTestId('order-total')).toBeVisible();
    expect(await shekelLeftOfDigits(page.locator('main bdi'))).toEqual([]);
    expect(await page.locator('main .font-mono').count()).toBe(0);
    const toAgorot = (s: string) => Math.round(Number(s.replace(/[^\d.]/g, '')) * 100);
    const lineTotals = await page.getByTestId('line-total').evaluateAll((els) =>
      els.map((el) => el.querySelector('bdi')?.textContent ?? ''),
    );
    const total = (await page.getByTestId('order-total').locator('bdi').first().textContent()) ?? '';
    expect(lineTotals.reduce((s, x) => s + toAgorot(x), 0)).toBe(toAgorot(total));
    // Inputs: decimal keypad, ≥3:1 border (line-strong), 14 px labels.
    const qty = page.locator('input[id^="qty-"]').first();
    await expect(qty).toHaveAttribute('inputmode', 'decimal');
    expect(await qty.evaluate((el) => getComputedStyle(el).borderColor)).toBe('rgb(122, 139, 130)');
    expect(await page.locator('label[for^="qty-"]').first().evaluate((el) => getComputedStyle(el).fontSize)).toBe('14px');
    // The sticky primary is never under the cookie bar or off-screen.
    const bar = (await page.getByTestId('portal-actions').boundingBox())!;
    expect(bar.y + bar.height).toBeLessThanOrEqual(844 + 1);
  });

  test('an invalid edit alone blocks the send — never "confirm as is" (review #1)', async ({ page }) => {
    const { token, poId, lineIds } = await freshSupplierLink();
    await setLocale(page, 'he');
    await page.goto(`/s/${token}`);
    await page.locator(`#qty-${lineIds[0]}`).fill('שש');
    await expect(page.locator('[data-primary]')).not.toHaveText('אישור ההזמנה כפי שהיא');
    await page.locator('[data-primary]').click();
    await expect(page.getByText('יש שדות לא תקינים')).toBeVisible();
    await expect(page.locator(`#qty-${lineIds[0]}`)).toBeFocused();
    await page.waitForTimeout(500);
    expect(await storedResponse(poId)).toBeNull();
    // The VAT basis is stated on the totals and the price field (review #5).
    await expect(page.getByTestId('order-total')).toContainText('לפני מע״מ');
    await expect(page.locator('label[for^="price-"]').first()).toContainText('לפני מע״מ');
  });

  test('a retried submit whose first try landed is the supplier\'s own answer, not "not saved" (review #6)', async ({ page }) => {
    const { token, poId, lineIds } = await freshSupplierLink();
    await setLocale(page, 'he');
    await page.goto(`/s/${token}`);
    await page.locator(`#qty-${lineIds[0]}`).fill('0.5');
    // First try reaches the server but the reply is lost (flaky 4G).
    let dropped = false;
    await page.route('**/api/supplier-confirm/**', async (route) => {
      if (dropped) return route.continue();
      dropped = true;
      await route.fetch();
      await route.abort('connectionreset');
    });
    await page.locator('[data-primary]').click();
    await expect(page.getByText('משהו השתבש')).toBeVisible();
    expect((await storedResponse(poId))?.status).toBe('changes');
    await page.locator('[data-primary]').click();
    await expect(page.getByTestId('portal-answered')).toContainText('התשובה שלכם נרשמה');
    await expect(page.getByTestId('portal-answered')).not.toContainText('לא נשמרו');
    expect(page.url()).not.toContain('answered=');
  });

  test('a dead link has no dashboard CTA', async ({ page }) => {
    await setLocale(page, 'he');
    await page.goto(`/s/${'x'.repeat(43)}`);
    await expect(page.locator('h1')).toHaveText('הקישור הזה כבר לא פעיל');
    await expect(page.locator('a[href="/dashboard"]')).toHaveCount(0);
  });
});

/* ── Screens: axe (wcag22aa + best-practice: 0 critical / 0 serious) at 390 + 1440, he + en ── */
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

async function seriousAxe(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> };
    };
    const res = await w.axe.run(
      { exclude: [['nextjs-portal']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } },
    );
    return res.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')}`));
  });
}

for (const locale of ['he', 'en'] as const) {
  for (const [vp, use] of [
    ['390', PHONE],
    ['1440', { viewport: { width: 1440, height: 900 } }],
  ] as const) {
    test.describe(`screens ${locale} · ${vp}`, () => {
      test.use(use);
      for (const path of ['/login', '/login/check-email', '/reset', '/reset?sent=1', '/s/:token', '/s/:dead']) {
        test(`${path}: axe clean, one h1, titled, skip link, legal footer`, async ({ page }) => {
          const { token } = path === '/s/:token' ? await freshSupplierLink() : { token: '' };
          await setLocale(page, locale);
          await page.goto(path.replace(':token', token).replace(':dead', 'y'.repeat(43)));
          await page.waitForLoadState('networkidle').catch(() => {});
          expect(await seriousAxe(page), `${path} axe`).toEqual([]);
          await expect(page.locator('h1')).toHaveCount(1);
          await expect(page).toHaveTitle(/ · RestoMatch$/);
          await expect(page.locator('a[href="#main"]')).toHaveCount(1);
          await expect(page.locator('footer a[href="/accessibility"]')).toBeVisible();
          await expect(page.locator('[data-testid="language-picker"], header button').first()).toBeVisible();
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
          if (locale === 'he') expect(await shekelLeftOfDigits(page.locator('main bdi'))).toEqual([]);
          await page.screenshot({ path: test.info().outputPath(`${path.replace(/[/:?=]/g, '_')}-${locale}-${vp}.png`), fullPage: true });
        });
      }
    });
  }
}
