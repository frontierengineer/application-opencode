#!/usr/bin/env node
// Checks this Application the way it ships: type-checked against Frontier's
// Application Interface, unit tested, and bundled the way the Host bundles it.
//
//   node scripts/check.mjs                      Frontier checkout at ../../frontier
//   FRONTIER_REPO=/path/to/frontier node scripts/check.mjs
//
// Every bundle imports the interface as '../application', because an installed
// Application's directory sits beside `application.d.ts`. That specifier is
// relative, so this script copies the sources into that layout in a temporary
// directory and runs tsc there, borrowing tsc, esbuild and Node's types from the
// Frontier checkout. Nothing of the interface is vendored here.

import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const name = basename(repo);
const frontier = process.env.FRONTIER_REPO || join(repo, '..', '..', 'frontier');

function need(path, what) {
  if (!existsSync(path)) {
    console.error(`Missing ${what}: ${path}`);
    console.error('Point FRONTIER_REPO at a Frontier checkout whose dependencies are installed.');
    process.exit(1);
  }
  return path;
}

const contract = need(join(frontier, 'interfaces', 'application.d.ts'), 'the Application Interface');
const tsc = need(join(frontier, 'node_modules', 'typescript', 'bin', 'tsc'), 'tsc');
const esbuild = need(join(frontier, 'node_modules', 'esbuild', 'lib', 'main.js'), 'esbuild');
const typeRoots = need(join(frontier, 'node_modules', '@types'), "Node's types");

const stage = mkdtempSync(join(tmpdir(), `${name}-check-`));
process.on('exit', () => rmSync(stage, { recursive: true, force: true }));
const staged = join(stage, name);

cpSync(contract, join(stage, 'application.d.ts'));
cpSync(repo, staged, {
  recursive: true,
  filter: (source) => {
    const part = relative(repo, source).split('/')[0];
    return part !== 'node_modules' && part !== '.git';
  },
});
if (existsSync(join(repo, 'node_modules'))) symlinkSync(join(repo, 'node_modules'), join(staged, 'node_modules'));

const tsconfig = JSON.parse(readFileSync(join(repo, 'tsconfig.json'), 'utf8'));
tsconfig.compilerOptions.typeRoots = [typeRoots, ...(existsSync(join(repo, 'node_modules', '@types')) ? [join(staged, 'node_modules', '@types')] : [])];
writeFileSync(join(staged, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));

let failed = false;
function step(title, command, args, options = {}) {
  const run = spawnSync(command, args, { encoding: 'utf8', ...options });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.split(`${staged}/`).join('').trim();
  if (run.status === 0) {
    console.log(`ok    ${title}`);
    if (process.env.VERBOSE && output) console.log(output);
  } else {
    failed = true;
    console.error(`FAIL  ${title}`);
    if (output) console.error(output.split('\n').map((line) => `      ${line}`).join('\n'));
  }
}

step('types', process.execPath, [tsc, '--noEmit', '-p', join(staged, 'tsconfig.json')], { cwd: staged });

const tests = existsSync(join(repo, 'test')) ? readdirSync(join(repo, 'test')).filter((file) => file.endsWith('.test.ts')) : [];
if (tests.length > 0) {
  step('tests', process.execPath, ['--test', '--test-reporter=dot', ...tests.map((file) => join('test', file))], { cwd: repo });
}

const { buildSync } = await import(esbuild);
const entries = [
  ['surface', 'browser'],
  ['host', 'node'],
  ['worker', 'node'],
];
for (const [entry, platform] of entries) {
  const file = ['ts', 'tsx'].map((extension) => join(repo, `${entry}.${extension}`)).find((path) => existsSync(path));
  if (!file) continue;
  try {
    const result = buildSync({
      entryPoints: [file],
      bundle: true,
      platform,
      format: 'esm',
      target: platform === 'node' ? 'node22' : 'chrome120',
      write: false,
      logLevel: 'silent',
      absWorkingDir: repo,
    });
    const bytes = result.outputFiles.reduce((total, output) => total + output.contents.length, 0);
    console.log(`ok    bundle ${entry} (${Math.round(bytes / 1024)} KiB)`);
  } catch (error) {
    failed = true;
    console.error(`FAIL  bundle ${entry}`);
    for (const message of error.errors ?? [{ text: String(error) }]) {
      console.error(`      ${message.location ? `${message.location.file}:${message.location.line}: ` : ''}${message.text}`);
    }
  }
}

if (statSync(join(repo, 'contributions.json')).size === 0) failed = true;
process.exit(failed ? 1 : 0);
