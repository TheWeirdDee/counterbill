import path from 'node:path';
import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { extractText, getDocumentProxy } from 'unpdf';

const SLUG = 'volume-dispute-aug-2026';
const files = (n: string) => path.resolve('tests/e2e/files', n);

async function startDemo(page: Page) {
  await page.goto(`/demo/${SLUG}`);
  await page.getByRole('button', { name: /Investigate this sample case/ }).click();
  await page.waitForURL(new RegExp(`/demo/${SLUG}/[0-9a-f-]{36}`));
}
async function waitForAssessment(page: Page, v: number) {
  await expect(page.getByText(new RegExp(`Assessment v${v} ·`))).toBeVisible({ timeout: 90_000 });
}
const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Case sections' }).getByRole('link', { name, exact: true });
async function pdfText(p: string) {
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(p)));
  return ((await extractText(pdf, { mergePages: true })).text as string) ?? '';
}
async function signUp(page: Page, email: string) {
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('E2E User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/app');
}

test('sample → live investigation → add evidence → revised finding → citation → edited letter → PDF', async ({ page }, info) => {
  await startDemo(page);

  // actual progress, driven by persisted events: agents appear and finish
  await expect(page.getByText('Test mode.').first()).toBeVisible(); // the run is honestly labelled
  await waitForAssessment(page, 1);
  await expect(page.getByRole('heading', { name: 'The packing-list estimate conflicts with the bill' })).toBeVisible();
  for (const a of ['Evidence Agent', 'Billing Agent', 'Contract Agent', 'Timeline Agent', 'Case Agent', 'Drafting Agent']) {
    await expect(page.getByText(a, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText('Reconstructed', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Not yet established')).toHaveCount(0);
  await expect(page.locator('.summary-strip')).toContainText('₦298,100');
  await expect(page.locator('.action-bar').getByRole('link', { name: 'Review letter' })).toBeVisible({ timeout: 60_000 });

  // add the published survey: the conclusion, the number and the letter all change, with the reason
  await page.getByRole('button', { name: 'Add published survey finding' }).click();
  await waitForAssessment(page, 2);
  await expect(page.locator('.change-banner')).toContainText('What changed, and why');
  await expect(page.locator('.change-banner')).toContainText('superseded');
  await expect(page.locator('.summary-strip')).toContainText('₦189,700');
  await expect(page.locator('.summary-strip')).toContainText('0.75 CBM');
  await expect(page.getByRole('heading', { name: /A measurement supports a volume difference/ })).toBeVisible();
  await expect(page.getByText('Up to date')).toBeVisible({ timeout: 60_000 }); // the Drafting Agent has finished revising the letter

  // open a source from a citation: viewer jumps to and highlights the passage
  await page.getByRole('button', { name: /Open source D4-p1-s\d+/ }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.span-block.hl')).toBeVisible();
  await expect(dialog).toContainText('Source-derived excerpt of a published regulator report');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // earlier reading preserved
  await tab(page, 'Findings').click();
  await page.getByRole('button', { name: /^Show \d+$/ }).click();
  await expect(page.locator('.finding.s-superseded').first()).toContainText('Superseded by');

  // letter: edit, persists across reload, marked unverified
  await tab(page, 'Letter').click();
  const requests = page.getByLabel('Specific requests');
  await expect(requests).toBeVisible();
  await requests.fill('Please send the rated-volume calculation. This line was written by me.');
  await requests.blur();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Specific requests')).toHaveValue(/written by me/);
  await expect(page.getByText(/Edited by you · not verified by Counterbill/)).toBeVisible();

  // PDF: needs the review acknowledgement, then downloads a real, correct document
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
  await page.getByLabel(/I have reviewed the facts/).check();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  const out = info.outputPath('complaint.pdf');
  await dl.saveAs(out);
  expect(dl.suggestedFilename()).toMatch(/^Counterbill-CB-[0-9A-F]{8}-Complaint-v\d+\.pdf$/);
  const text = await pdfText(out);
  expect(text).toContain('₦189,700');
  expect(text).toContain('₦596,200');
  expect(text).toContain('₦406,500');
  expect(text).toContain('written by me');
  expect(text).toMatch(/reconstructed for demonstration/i);
  expect(text).toContain('Prepared with Counterbill; reviewed by sender');
  expect(text).not.toMatch(/guaranteed refund|you are owed/i);
  const [sum] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download evidence summary' }).click()]);
  await sum.saveAs(info.outputPath('summary.pdf'));
  const st = await pdfText(info.outputPath('summary.pdf'));
  expect(st).toContain('0.757348');
  expect(st).toContain('TEST MODE');
});

test('hypothetical rate sheet downgrades the overcharge reading and the letter asks instead of alleging', async ({ page }) => {
  await startDemo(page);
  await waitForAssessment(page, 1);
  await page.getByRole('button', { name: 'Add published survey finding' }).click();
  await waitForAssessment(page, 2);
  await page.getByRole('button', { name: 'Add hypothetical rate sheet' }).click();
  await waitForAssessment(page, 3);
  await expect(page.getByRole('heading', { name: /stated contract term may explain the billed volume/ })).toBeVisible();
  await expect(page.locator('.change-banner')).toContainText('superseded');
  await expect(page.getByText('Hypothetical illustration', { exact: true }).first()).toBeVisible();
  await tab(page, 'Letter').click();
  await expect(page.getByLabel('What remains uncertain')).toHaveValue(/minimum chargeable volume/);
});

test('missing evidence gives questions and a provisional result, never invented values', async ({ page }) => {
  await signUp(page, `missing-${Date.now()}@example.test`);
  await page.goto('/app/new');
  await page.getByLabel('Case name').fill('Only a complaint, no documents');
  await page.getByLabel('What is your concern?').fill('The freight company billed me a lot more than I expected.');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Start investigation' }).click();
  await page.waitForURL(/\/app\/cases\/[0-9a-f-]{36}/);
  await waitForAssessment(page, 1);
  await expect(page.getByRole('heading', { name: 'Not enough evidence yet' })).toBeVisible();
  await expect(page.locator('.summary-strip')).toContainText('Not yet established');
  await expect(page.getByRole('heading', { name: 'Questions for you' })).toBeVisible();
  await expect(page.getByText('Missing: Billed volume').or(page.getByText(/Billed volume\./)).first()).toBeVisible();
});

test('private case: upload → parse → correct a fact → reassess → export; and another account cannot see it', async ({ page, browser }, info) => {
  const email = `owner-${Date.now()}@example.test`;
  await signUp(page, email);
  await page.goto('/app/new');
  await page.getByLabel('Case name').fill('E2E private case');
  await page.getByLabel('Your company').fill('E2E Imports');
  await page.getByLabel('Freight company (other party)').fill('E2E Carrier');
  await page.getByLabel('What is your concern?').fill('The invoice uses 1.10 CBM, but my packing list says 0.55 CBM.');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('#file-input').setInputFiles([files('invoice.txt'), files('packing-list.txt')]);
  await expect(page.getByRole('row', { name: /invoice\.txt/ })).toContainText('Ready', { timeout: 30_000 });
  await expect(page.getByRole('row', { name: /packing-list\.txt/ })).toContainText('Ready', { timeout: 30_000 });
  // unsupported file is refused with a usable message
  await page.locator('#file-input').setInputFiles({ name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
  await expect(page.getByText(/is not supported/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Start investigation' }).click();
  await page.waitForURL(/\/app\/cases\/[0-9a-f-]{36}/);
  const caseUrl = page.url();
  const caseId = caseUrl.split('/').pop()!;
  await waitForAssessment(page, 1);
  await expect(page.locator('.summary-strip')).toContainText('₦298,100');

  // user correction keeps provenance and re-runs the comparison
  await page.getByRole('row', { name: /Declared \/ estimated volume.*extracted/ }).first().getByRole('button', { name: 'Correct' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel(/Correct value/).fill('0.70');
  await dlg.getByLabel(/Why/).fill('Packing list typo');
  await dlg.getByRole('button', { name: 'Save correction' }).click();
  await waitForAssessment(page, 2);
  await expect(page.locator('.summary-strip')).toContainText('0.70 CBM');
  await expect(page.locator('.summary-strip')).toContainText('₦216,800'); // 1.10 − 0.70 = 0.40 × 542,000
  await tab(page, 'Evidence').click();
  await page.getByRole('button', { name: /packing-list\.txt/ }).click();
  await expect(page.getByText('Superseded by correction').first()).toBeVisible();
  await expect(page.getByText('User-corrected').first()).toBeVisible();

  // export works for a private case, with no demo disclosure
  await tab(page, 'Letter').click();
  await page.getByLabel(/I have reviewed the facts/).check();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  await dl.saveAs(info.outputPath('private.pdf'));
  const t = await pdfText(info.outputPath('private.pdf'));
  expect(t).toContain('₦216,800');
  expect(t).not.toMatch(/reconstructed for demonstration/i);

  // a second account gets "not found" everywhere and no content
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await signUp(p2, `intruder-${Date.now()}@example.test`);
  const base = new URL(caseUrl).origin;
  for (const u of [`/api/cases/${caseId}`, `/api/cases/${caseId}/documents`, `/api/cases/${caseId}/documents/D1/preview`, `/api/cases/${caseId}/letter`, `/api/cases/${caseId}/trace`, `/api/cases/${caseId}/exports`]) {
    const r = await p2.request.get(base + u);
    expect(r.status(), u).toBe(404);
    expect(await r.text()).not.toContain('E2E Carrier');
  }
  expect((await p2.request.post(`${base}/api/cases/${caseId}/start`, { headers: { Origin: base } })).status()).toBe(404);
  await p2.goto(caseUrl);
  await expect(p2.getByRole('heading', { name: 'This case isn’t available' })).toBeVisible();
  await expect(p2.getByText('E2E Carrier')).toHaveCount(0);
  // signed-out visitors are sent to sign in
  const anon = await browser.newContext();
  const p3 = await anon.newPage();
  await p3.goto(caseUrl);
  await expect(p3).toHaveURL(/\/login\?next=/);
  const noAuth = await p3.request.get(`${base}/api/cases/${caseId}`);
  expect(noAuth.status()).toBe(401);
  await ctx2.close();
  await anon.close();
});

test('stream interruption and reconnect: UI converges on the stored state with no duplicate transitions', async ({ page }) => {
  await startDemo(page);
  // cut the live stream while the investigation is running
  await page.route('**/api/cases/*/events*', (r) => r.abort());
  await page.waitForTimeout(5000);
  await page.unroute('**/api/cases/*/events*');
  await waitForAssessment(page, 1);
  await expect(page.getByText('Live', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await tab(page, 'Activity').click();
  await page.getByRole('button', { name: 'Event list' }).click();
  const base = page.url().split('/activity')[0].replace(/\/demo\/[^/]+\//, '/api/cases/');
  // the run may still be finishing when the page loads: the UI list must converge on exactly the stored events
  await expect
    .poll(async () => {
      const trace = await (await page.request.get(`${base}/trace`)).json();
      const stored = trace.events.filter((e: { type: string }) => !e.type.startsWith('mozaik.')).length;
      return (await page.locator('.feed li').count()) - stored;
    }, { timeout: 30_000 })
    .toBe(0);
  const trace = await (await page.request.get(`${base}/trace`)).json();
  const seqs = trace.events.map((e: { seq: number }) => e.seq);
  expect(new Set(seqs).size).toBe(seqs.length);
});

test('a refresh mid-investigation keeps a consistent state', async ({ page }) => {
  await startDemo(page);
  await expect(page.getByText(/Agents/).first()).toBeVisible();
  await page.waitForTimeout(2500);
  await page.reload();
  await waitForAssessment(page, 1);
  await page.reload();
  await expect(page.getByText(/Assessment v1 ·/)).toBeVisible();
  await expect(page.locator('.summary-strip')).toContainText('₦298,100');
});

test('sample stays usable when the public report site is unreachable (cached excerpt, labelled)', async ({ page }) => {
  await page.route(/shipperscouncil\.gov\.ng/, (r) => r.abort());
  await startDemo(page);
  await waitForAssessment(page, 1);
  await page.getByRole('button', { name: 'Add published survey finding' }).click();
  await waitForAssessment(page, 2);
  await page.getByRole('button', { name: /Open NSC report excerpt/ }).click();
  await expect(page.getByRole('dialog')).toContainText('cached locally');
  await expect(page.getByRole('dialog')).toContainText('Reported surveyed volume: 0.75 CBM');
});

test('the public landing page explains the product and its limits', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText("doesn’t add up");
  await expect(page.getByRole('link', { name: 'Investigate a sample case' })).toBeVisible();
  await expect(page.getByText('1.10 CBM').first()).toBeVisible();
  await expect(page.getByText('₦189,700').first()).toBeVisible();
  await expect(page.getByText('Unresolved', { exact: true })).toBeVisible();
  await expect(page.getByText(/not legal advice/i).first()).toBeVisible();
  await expect(page.getByText(/testimonial|customers trust|users saved/i)).toHaveCount(0);
});

test('incorrect credentials and unauthenticated settings access are handled', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('nobody@example.test');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('p.error-text')).toContainText('do not match');
  await page.goto('/app/settings');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fsettings/);
});

test('account data controls: delete everything', async ({ page, request }) => {
  const email = `wipe-${Date.now()}@example.test`;
  await signUp(page, email);
  await page.goto('/app/settings');
  await page.getByLabel('Your name').fill('Wipe Me');
  await page.getByLabel(/Address, email and phone/).fill('1 Test Street, Lagos');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved. New letters will use these details.')).toBeVisible();
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByLabel(/Type DELETE/).fill('DELETE');
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await page.waitForURL('**/');
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('p.error-text')).toBeVisible();
  void request;
});
