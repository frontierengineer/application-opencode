import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DesignSystemPage, frameDocument, loadDesignSystem } from './view/design-system.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const frontier = process.env.FRONTIER_REPO || join(root, '..', '..', 'frontier');
const playwrightEntry = join(frontier, 'node_modules', 'playwright', 'index.mjs');
const esbuildEntry = join(frontier, 'node_modules', 'esbuild', 'lib', 'main.js');
const available = existsSync(playwrightEntry) && existsSync(esbuildEntry);

type Locator = { textContent(): Promise<string | null>; click(): Promise<void>; waitFor(): Promise<void>; count(): Promise<number>; nth(index: number): Locator; first(): Locator; locator(selector: string): Locator };
type Page = {
  setContent(html: string): Promise<void>;
  addScriptTag(options: { content: string }): Promise<unknown>;
  evaluate<T>(code: string): Promise<T>;
  locator(selector: string): Locator;
  getByRole(role: string, options?: Record<string, unknown>): Locator;
  getByText(text: string, options?: Record<string, unknown>): Locator;
  screenshot(options: { path: string }): Promise<unknown>;
};

let browser: { newPage(options?: Record<string, unknown>): Promise<Page>; close(): Promise<void> } | null = null;
let bundle = '';
let designSystem: DesignSystemPage = { stylesheet: '', behaviorsScript: '' };
// A directory to keep a screenshot of the view in, in each colour scheme.
const shots = process.env.VIEW_SHOTS;

before(async () => {
  if (!available) return;
  const { buildSync } = (await import(esbuildEntry)) as { buildSync: (options: Record<string, unknown>) => { outputFiles: { text: string }[] } };
  designSystem = await loadDesignSystem(frontier, buildSync);
  bundle = buildSync({ entryPoints: [join(root, 'test', 'view', 'page.ts')], bundle: true, format: 'iife', platform: 'browser', write: false, absWorkingDir: root }).outputFiles[0]!.text;
  const { chromium } = (await import(playwrightEntry)) as { chromium: { launch(): Promise<typeof browser> } };
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
});

test('the configuration view states OpenCode on every worker, its models, and how to add a provider', { skip: available ? false : 'Playwright or esbuild is not in the Frontier checkout' }, async () => {
  for (const mode of ['dark', 'light'] as const) await checkView(mode);
});

async function checkView(mode: 'dark' | 'light'): Promise<void> {
  const page = await browser!.newPage({ viewport: { width: 1100, height: 820 } });
  await page.setContent(frameDocument(designSystem, mode));
  await page.addScriptTag({ content: designSystem.behaviorsScript });
  await page.addScriptTag({ content: bundle });
  await page.evaluate('window.mountView()');
  await page.locator('tbody tr').nth(3).waitFor();
  const rows = await page.evaluate<string[][]>("[...document.querySelectorAll('tbody tr')].map((row) => [...row.children].map((cell) => cell.textContent.trim()))");
  assert.deepEqual(rows, [
    ['Laptop', 'Ready', 'Opus 5.5Sonnet 5.5'],
    ['Build server', 'Not readyOpenCode at /usr/bin/opencode does not start: exit code 127. Reinstall it, or remove it so it is installed automatically.', 'None listed yet'],
    ['Old desktop', 'Offline', 'None listed yet'],
    ['New box', 'Not reportedThis worker has not reported on OpenCode yet.', 'None listed yet'],
  ]);
  assert.equal(await page.evaluate<string>("document.querySelector('tbody tr:nth-child(1)  frontier-badge').dataset.tone"), 'success');
  await page.getByRole('button', { name: 'Copy command' }).click();
  await page.getByText('Command copied.').waitFor();
  assert.deepEqual(await page.evaluate<string[]>('window.clipboard'), ['opencode auth login']);
  await page.evaluate("window.signIn('w2')");
  let state: string | null = null;
  for (let attempt = 0; attempt < 40 && state !== 'Ready'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    state = await page.locator('tbody tr').nth(1).locator('frontier-badge').first().textContent();
  }
  assert.equal(state, 'Ready');
  if (shots) await page.screenshot({ path: join(shots, `configuration-${mode}.png`) });
}
