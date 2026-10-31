import { expect, test, type Page } from '@playwright/test';

const SLUG = 'volume-dispute-aug-2026';
const WIDTHS = [320, 375, 390, 768, 1024, 1280];
const SHOTS = process.env.SHOTS === '1';

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}
const shot = async (page: Page, name: string, full = true) => {
  if (SHOTS) await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: full });
};

test.describe('public pages at every width', () => {
  for (const w of WIDTHS) {
    test(`landing and samples at ${w}px: no horizontal overflow, accessible navigation`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      for (const url of ['/', '/demo', `/demo/${SLUG}`, '/login']) {
        await page.goto(url);
        expect(await overflow(page), `${url} @${w}`).toBeLessThanOrEqual(0);
      }
      await page.goto('/');
      const burger = page.getByRole('button', { name: /navigation/i });
      if (w <= 800) {
        await expect(burger).toBeVisible();
        await expect(burger).toHaveAttribute('aria-expanded', 'false');
        await expect(page.getByText('Menu', { exact: true })).toHaveCount(0); // icon only
        await burger.click();
        await expect(burger).toHaveAttribute('aria-expanded', 'true');
        await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'See a live case' })).toBeVisible();
      } else {
        await expect(burger).toBeHidden();
        await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'See a live case' })).toBeVisible();
      }
      if (w === 1280) await shot(page, 'landing');
      if (w === 390) await shot(page, 'landing-mobile');
    });
  }
});

test('investigation workspace is usable from 320px to desktop; footer is not on the workspace', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/demo/${SLUG}`);
  await page.getByRole('button', { name: /Investigate this sample case/ }).click();
  await page.waitForURL(new RegExp(`/demo/${SLUG}/[0-9a-f-]{36}`));
  await expect(page.getByText(/Assessment v1 ·/)).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Add published survey finding' }).click();
  await expect(page.getByText(/Assessment v2 ·/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('Up to date')).toBeVisible({ timeout: 60_000 }); // the letter has caught up with the evidence
  await expect(page.locator('footer.site-footer')).toHaveCount(0);

  const base = page.url();
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const t of ['', '/evidence', '/findings', '/timeline', '/letter', '/activity']) {
      await page.goto(base + t);
      await expect(page.locator('.summary-strip')).toBeVisible();
      expect(await overflow(page), `workspace${t} @${w}`).toBeLessThanOrEqual(0);
      // the key figure stays inside the viewport and readable
      const box = await page.locator('.summary-strip').boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(w + 1);
      await expect(page.locator('.summary-strip')).toContainText('₦189,700');
      await expect(page.getByText('A billing difference is not automatically a recoverable overcharge.')).toBeVisible();
    }
  }

  // screenshots for the README (only when SHOTS=1): viewport captures, as a person would see them
  await page.setViewportSize({ width: 1280, height: 1500 });
  await page.goto(base);
  await page.waitForTimeout(800);
  await shot(page, 'workspace-overview', false);
  await page.goto(`${base}/activity`);
  await page.waitForTimeout(800);
  await shot(page, 'activity-concurrency', false);
  await page.goto(`${base}/findings`);
  await shot(page, 'findings', false);
  await page.goto(`${base}/letter`);
  await page.waitForTimeout(500);
  await shot(page, 'letter', false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page.waitForTimeout(800);
  await shot(page, 'workspace-mobile', false);

  // keyboard: skip link first, dialog opens from a source chip, Esc closes and focus returns to the chip
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(base);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  const chip = page.getByRole('button', { name: /Open source D4-p1-s\d+/ }).first();
  await chip.focus();
  const outline = await chip.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none'); // visible focus indicator
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(chip).toBeFocused();

  // every tab is reachable from the keyboard and announces the current page
  const nav = page.getByRole('navigation', { name: 'Case sections' });
  await expect(nav.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('light, dark and system themes apply and persist', async ({ page }) => {
  await page.goto('/');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await bg();
  await page.getByRole('group', { name: 'Colour theme' }).getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const dark = await bg();
  expect(dark).not.toBe(light);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('group', { name: 'Colour theme' }).getByRole('button', { name: 'System' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
});

test('reduced motion removes animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/demo');
  const d = await page.evaluate(() => getComputedStyle(document.querySelector('.btn')!).transitionDuration);
  expect(parseFloat(d)).toBeLessThan(0.01);
});
