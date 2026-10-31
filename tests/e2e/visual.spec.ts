/**
 * Visual and accessibility checks for the redesign: computed fonts, layout widths at 100% zoom, axe (including
 * colour contrast) in both themes, footer links that resolve, and (with SHOTS=1) the screenshots used by /docs.
 * The model is the labelled test-mode stand-in; nothing here calls a provider.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const SLUG = 'volume-dispute-aug-2026';
const SHOTS = process.env.SHOTS === '1';
const THEMES = ['light', 'dark'] as const;

async function axe(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = res.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(bad, `axe on ${label}`).toEqual([]);
}

function trackConsole(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test.describe('public pages: fonts, widths, contrast', () => {
  for (const theme of THEMES) {
    test(`axe and console are clean in the ${theme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 1280, height: 900 });
      const errors = trackConsole(page);
      for (const url of ['/', '/examples', `/examples/${SLUG}`, '/docs', '/login', '/signup']) {
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        if (url === '/') {
          // open every FAQ answer so its text is checked too
          const qs = page.locator('.faq-item button');
          for (let i = 0; i < (await qs.count()); i++) await qs.nth(i).click();
        }
        await axe(page, `${url} (${theme})`);
      }
      expect(errors).toEqual([]);
    });
  }

  test('Inter Tight and Inter are loaded and applied', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      const fam = (sel: string) => getComputedStyle(document.querySelector(sel)!).fontFamily;
      return {
        h1: fam('h1'),
        body: fam('p.lead'),
        btn: fam('.btn'),
        loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/['"]/g, '')),
        h1Weight: getComputedStyle(document.querySelector('h1')!).fontWeight,
        figures: getComputedStyle(document.querySelector('.recon-row .num')!).fontVariantNumeric,
      };
    });
    expect(fonts.h1).toContain('Inter Tight Variable');
    expect(fonts.body).toContain('Inter Variable');
    expect(fonts.btn).toContain('Inter Variable');
    expect(fonts.loaded.some((f) => /Inter Tight/.test(f))).toBe(true);
    expect(fonts.loaded.some((f) => /^Inter Variable/.test(f))).toBe(true);
    expect(fonts.figures).toContain('tabular-nums');
  });

  test('layout at 100% zoom: not compressed, sensible sizes', async ({ page }) => {
    for (const [w, heroMin, heroMax] of [
      [1440, 60, 76],
      [1280, 60, 76],
      [390, 34, 44],
    ] as const) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto('/examples');
      const m = await page.evaluate(() => ({
        root: getComputedStyle(document.documentElement).fontSize,
        body: getComputedStyle(document.body).fontSize,
        dpr: window.devicePixelRatio,
        container: document.querySelector('.container')!.getBoundingClientRect().width,
        card: document.querySelector('.example-card')!.getBoundingClientRect().width,
        header: document.querySelector('.site-header')!.getBoundingClientRect().height,
        vw: window.innerWidth,
      }));
      expect(m.root).toBe('16px');
      expect(m.body).toBe('16px');
      expect(m.dpr).toBe(1);
      expect(m.container).toBeLessThanOrEqual(1280);
      if (w >= 1280) {
        expect(m.container).toBeGreaterThanOrEqual(1100);
        expect(m.card).toBeGreaterThanOrEqual(480);
        expect(m.header).toBeGreaterThanOrEqual(68);
        expect(m.header).toBeLessThanOrEqual(76);
      } else {
        expect(m.card).toBeGreaterThanOrEqual(w - 48);
      }
      await page.goto('/');
      const h1 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('h1')!).fontSize));
      expect(h1, `hero h1 @${w}`).toBeGreaterThanOrEqual(heroMin);
      expect(h1, `hero h1 @${w}`).toBeLessThanOrEqual(heroMax);
    }
  });

  test('footer links resolve and anchors exist', async ({ page, request }) => {
    await page.goto('/');
    const hrefs = await page.locator('footer.site-footer a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href')!));
    expect(hrefs.length).toBeGreaterThanOrEqual(12);
    for (const h of hrefs) {
      const [path, hash] = h.split('#');
      const res = await request.get(path || '/');
      expect(res.status(), h).toBeLessThan(400);
      if (hash) {
        const html = await res.text();
        expect(html, `anchor ${h}`).toContain(`id="${hash}"`);
      }
    }
  });

  test('old /demo links redirect to /examples', async ({ page }) => {
    await page.goto(`/demo/${SLUG}`);
    await expect(page).toHaveURL(new RegExp(`/examples/${SLUG}$`));
    await page.goto('/demo');
    await expect(page).toHaveURL(/\/examples$/);
  });

  test('the FAQ accordion is keyboard operable and announces its state', async ({ page }) => {
    await page.goto('/');
    const first = page.locator('.faq-item button').first();
    await first.focus();
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('region', { name: 'Who is Counterbill for?' })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(first).toHaveAttribute('aria-expanded', 'false');
  });

  test('theme menu: keyboard, Escape and focus return', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    const trigger = page.getByRole('button', { name: /Colour theme/ });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu', { name: 'Colour theme' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('mobile menu: opens, labelled, closes on Escape and on navigation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const burger = page.getByRole('button', { name: 'Open navigation' });
    await burger.click();
    await expect(page.getByRole('button', { name: 'Close navigation' })).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Docs' }).click();
    await expect(page).toHaveURL(/\/docs$/);
    await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-expanded', 'false');
  });

  test('reduced motion: hero content is visible immediately', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const o = await page.evaluate(() => getComputedStyle(document.querySelector('h1')!).opacity);
    expect(o).toBe('1');
  });
});

test.describe('signed-in surfaces and the workspace', () => {
  test('dashboard empty state, new case, settings; example workspace; axe in both themes', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = trackConsole(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    const email = `visual-${Date.now()}@example.test`;
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Visual Check');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/app');

    // empty dashboard: exact copy, one primary action, counts hidden because there are none
    await expect(page.getByRole('heading', { name: 'Your first case starts with the records.' })).toBeVisible();
    await expect(page.getByText('Add an invoice and any quote or packing list you have.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create a case' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Explore an example' })).toBeVisible();
    const rail = await page.locator('aside.rail').boundingBox();
    expect(rail!.width).toBeGreaterThanOrEqual(224);
    expect(rail!.width).toBeLessThanOrEqual(240);

    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme });
      await axe(page, `dashboard (${theme})`);
    }

    // new case, step 2 (shot for the docs)
    await page.goto('/app/new');
    await page.getByLabel('Case name').fill('Lagos LCL shipment, August');
    await page.getByLabel('Your company').fill('Example Importers Ltd');
    await page.getByLabel('Freight company (other party)').fill('Example Freight Ltd');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Add evidence' })).toBeVisible();
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme });
      await axe(page, `new case (${theme})`);
      if (SHOTS) await page.screenshot({ path: `public/docs/new-case-${theme}.png` });
    }

    await page.goto('/app/settings');
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme });
      await axe(page, `settings (${theme})`);
    }

    // a populated dashboard row appears for the created case
    await page.goto('/app');
    await expect(page.getByRole('link', { name: 'Lagos LCL shipment, August' }).first()).toBeVisible();
    await expect(page.getByText('Add your records').first()).toBeVisible();
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme });
      await axe(page, `dashboard with a case (${theme})`);
    }

    // the example workspace (a separate browser identity: examples are ownerless)
    await page.context().clearCookies();
    await page.goto(`/examples/${SLUG}`);
    await page.getByRole('button', { name: /Start this example/ }).click();
    await page.waitForURL(new RegExp(`/examples/${SLUG}/[0-9a-f-]{36}`));
    await expect(page.getByText(/Assessment v1 ·/)).toBeVisible({ timeout: 90_000 });
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Add published survey finding' }).click();
    await expect(page.getByText(/Assessment v2 ·/)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('Up to date')).toBeVisible({ timeout: 60_000 });
    const base = page.url();

    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      for (const t of ['', '/evidence', '/findings', '/timeline', '/letter', '/activity']) {
        await page.goto(base + t);
        await expect(page.locator('.summary-strip')).toContainText('₦189,700');
        await page.waitForTimeout(400);
        await axe(page, `workspace${t || '/'} (${theme})`);
        if (SHOTS && t === '') await page.screenshot({ path: `public/docs/case-overview-${theme}.png` });
        if (SHOTS && t === '/letter') await page.screenshot({ path: `public/docs/letter-${theme}.png` });
      }
      if (SHOTS) {
        await page.goto(base);
        await page.locator('.summary-strip .source-chip').first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `public/docs/source-viewer-${theme}.png` });
        await page.keyboard.press('Escape');
      }
    }
    expect(errors.filter((e) => !/favicon/.test(e))).toEqual([]);
  });
});
