import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Contributions } from '../../application';

const root = new URL('..', import.meta.url).pathname;
const contributions = JSON.parse(readFileSync(join(root, 'contributions.json'), 'utf8')) as Contributions;
const translations = JSON.parse(readFileSync(join(root, 'translations.json'), 'utf8')) as Record<string, Record<string, string>>;

async function bundle(name: string): Promise<Record<string, unknown> | null> {
  for (const extension of ['ts', 'tsx']) {
    const path = join(root, `${name}.${extension}`);
    if (existsSync(path)) return ((await import(path)) as { registration: Record<string, unknown> }).registration;
  }
  return null;
}

function keys(value: unknown): string[] {
  return value && typeof value === 'object' ? Object.keys(value).sort() : [];
}

function ids(list: readonly { id: string }[] | undefined): string[] {
  return (list ?? []).map((item) => item.id).sort();
}

test('the id, title and color are what the interface allows', () => {
  assert.match(contributions.id, /^[A-Za-z0-9._/-]{1,200}$/);
  assert.ok(contributions.id.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'));
  assert.match(contributions.color, /^#[0-9a-fA-F]{6}$/);
  assert.ok(contributions.title.length > 0);
});

test('the id, the package name and the repository name the same Application', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; license: string; repository: { url: string } };
  assert.equal(contributions.id, `github.com/frontierengineer/${pkg.name}`);
  assert.equal(pkg.repository.url, `git+https://${contributions.id}.git`);
  assert.equal(pkg.license, 'MIT');
  assert.ok(existsSync(join(root, 'package-lock.json')), 'package.json comes with package-lock.json');
});

test('every bundle implements exactly what the contributions declare', async () => {
  const surface = await bundle('surface');
  const host = await bundle('host');
  const worker = await bundle('worker');
  const declaredSurface = contributions.surface ?? {};
  const declaredHost = contributions.host ?? {};
  const declaredWorker = contributions.worker ?? {};
  for (const singular of ['desktop', 'panel', 'display', 'configuration'] as const) {
    assert.equal(singular in declaredSurface, !!surface && singular in surface, `surface ${singular}`);
  }
  assert.deepEqual(keys(surface?.actions), ids(declaredSurface.actions), 'surface actions');
  assert.deepEqual(keys(surface?.optionSources), ids(declaredSurface.optionSources), 'surface option sources');
  assert.deepEqual(keys(surface?.modals), ids(declaredSurface.modals), 'surface modals');
  for (const singular of ['notifier', 'setupCheck'] as const) {
    assert.equal(singular in declaredHost, !!host && singular in host, `host ${singular}`);
  }
  assert.deepEqual(keys(host?.methods), ids(declaredHost.methods), 'host methods');
  for (const singular of ['runtime', 'workspaceProvisioner', 'daemon'] as const) {
    assert.equal(singular in declaredWorker, !!worker && singular in worker, `worker ${singular}`);
  }
  assert.deepEqual(keys(worker?.workloads), ids(declaredWorker.workloads), 'worker workloads');
  const actionIds = new Set(ids(declaredSurface.actions));
  for (const binding of declaredSurface.keybindings ?? []) assert.ok(actionIds.has(binding.actionId), `key binding ${binding.chord}`);
  for (const badge of declaredSurface.badges ?? []) assert.ok(actionIds.has(badge.actionId), `badge ${badge.id}`);
});

function sources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === 'test' || entry.startsWith('.')) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(entry)) found.push(path);
  }
  return found;
}

test('every language has every token, and every token the code uses is there', () => {
  const english = translations.en;
  assert.ok(english, 'translations.json has English');
  const tokens = new Set(Object.keys(english));
  for (const [language, table] of Object.entries(translations)) {
    assert.deepEqual(Object.keys(table).sort(), [...tokens].sort(), `tokens of ${language}`);
  }
  const used = new Set<string>();
  for (const path of sources(root)) {
    const code = readFileSync(path, 'utf8');
    for (const match of code.matchAll(/\b(?:t|translate|tr)\(\s*'([a-z0-9_.]+)'/g)) used.add(match[1]!);
    for (const match of code.matchAll(/\btext\(\s*\w+,\s*'([a-z0-9_.]+)'/g)) used.add(match[1]!);
  }
  for (const token of used) assert.ok(tokens.has(token), `token ${token} is in translations.json`);
});
