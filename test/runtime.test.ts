import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Failure, LaunchedAgent, RuntimeLaunchInput, RuntimeProbe } from '../../application';
import { agentVersion, createOpenCodeRuntime } from '../src/runtime.ts';
import { launchConfig } from '../src/config.ts';
import { parseModels, toRuntimeModels } from '../src/models.ts';
import { eventually, harness, request } from './harness.ts';

function probeOf(answer: unknown): RuntimeProbe {
  assert.ok(answer && typeof answer === 'object' && 'ready' in answer, `expected a probe, got ${JSON.stringify(answer)}`);
  return answer as RuntimeProbe;
}

function failureOf(answer: unknown): Failure {
  assert.ok(answer && typeof answer === 'object' && 'ok' in answer && answer.ok === false, `expected a failure, got ${JSON.stringify(answer)}`);
  return answer as Failure;
}

const launchInput = (directory: string, extra: Partial<RuntimeLaunchInput> = {}): RuntimeLaunchInput => ({
  directory,
  options: {},
  model: null,
  agentDefinition: '',
  environment: { FROM_WORKER: 'yes' },
  ...extra,
});

test('a worker without OpenCode reports it missing, install puts the pinned version in the private directory, and it is ready with its models', async () => {
  const h = harness();
  const runtime = createOpenCodeRuntime(h.context, h.machine);
  const missing = probeOf(await runtime.probe());
  assert.deepEqual(missing, { ready: false, missing: true, reason: 'OpenCode is not installed on this worker yet. It is installed automatically.' });
  h.machine.env.FAKE_NPM_LOG = join(h.base, 'npm.json');
  assert.equal(await runtime.install(), undefined);
  const args = JSON.parse(readFileSync(join(h.base, 'npm.json'), 'utf8')) as string[];
  assert.deepEqual(args.slice(0, 3), ['install', '--prefix', join(h.base, 'private', 'agent')]);
  assert.equal(args[args.length - 1], `opencode-ai@${agentVersion}`);
  const probe = await eventually(async () => probeOf(await runtime.probe()), (answer) => (answer.models?.length ?? 0) > 0);
  assert.equal(probe.ready, true);
  assert.equal(probe.reason, undefined);
  assert.deepEqual(probe.models, [
    {
      label: 'Big Pickle (opencode)',
      versions: [{
        id: 'opencode/big-pickle',
        label: 'Big Pickle',
        contextWindow: 200000,
        settings: [{
          type: 'select',
          key: 'variant',
          label: 'Variant',
          description: 'How much the model reasons before it answers.',
          choices: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }],
        }],
      }],
    },
    {
      label: 'Claude Opus (anthropic)',
      versions: [
        { id: 'anthropic/claude-opus-5-5', label: 'Claude Opus 5.5', contextWindow: 1000000 },
        { id: 'anthropic/claude-opus-4-8', label: 'Claude Opus 4.8', contextWindow: 200000 },
      ],
    },
  ]);
});

test('an OpenCode that does not start says so with its own words', async () => {
  const h = harness();
  const runtime = createOpenCodeRuntime(h.context, h.machine);
  await runtime.install();
  h.machine.env.FAKE_OPENCODE_BROKEN = '1';
  const fresh = createOpenCodeRuntime(h.context, h.machine);
  const probe = probeOf(await fresh.probe());
  assert.equal(probe.ready, false);
  assert.match(probe.reason ?? '', /^OpenCode at .* does not start: error while loading shared libraries: libstdc\+\+\.so\.6\. Reinstall it/);
});

test('a failed install is reported and waits before it is tried again', async () => {
  const h = harness();
  h.machine.env.FAKE_NPM_FAIL = '1';
  const runtime = createOpenCodeRuntime(h.context, h.machine);
  const failed = failureOf(await runtime.install());
  assert.equal(failed.message, 'Installing OpenCode did not finish: npm error code E404 npm error 404 Not Found - GET https://registry.npmjs.org/opencode-ai.');
  assert.match(probeOf(await runtime.probe()).reason ?? '', /tried again in 1 min\.$/);
  h.advance(2 * 60_000);
  assert.equal(probeOf(await runtime.probe()).missing, true);
});

function ownOpenCode(h: ReturnType<typeof harness>, directory: string, prefix = ''): string {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'opencode'), `#!/bin/sh\n${prefix}exec "${process.execPath}" "${new URL('./fixtures/fake-opencode.mjs', import.meta.url).pathname}" "$@"\n`);
  chmodSync(join(directory, 'opencode'), 0o755);
  return join(directory, 'opencode');
}

test('an OpenCode the person installed is used, from the PATH or from its own installer, and the log says which runs', async () => {
  const h = harness();
  const own = ownOpenCode(h, join(h.home, '.opencode', 'bin'), 'FAKE_OPENCODE_VERSION=1.20.3 ');
  const runtime = createOpenCodeRuntime(h.context, h.machine);
  assert.equal(probeOf(await runtime.probe()).ready, true);
  const launched = (await runtime.launch(launchInput(h.home))) as LaunchedAgent;
  assert.equal(h.spawned[0]?.command, own);
  assert.deepEqual(h.spawned[0]?.args, ['acp']);
  await launched.stop();
  assert.deepEqual(h.logs.filter(({ message }) => message.startsWith('OpenCode 1')).map(({ message }) => message), [`OpenCode 1.20.3 runs as the person installed it, at ${own}.`]);
});

test("an OpenCode the person installed that is too old, of another major version or does not start is passed over for the pinned one, and the log says why", async () => {
  for (const [prefix, why] of [
    ['FAKE_OPENCODE_VERSION=1.4.0 ', 'is 1.4.0, older than 1.19.6'],
    ['FAKE_OPENCODE_VERSION=2.0.1 ', 'is 2.0.1, a major version after 1.19.6 that Frontier has not been tested with'],
    ['FAKE_OPENCODE_BROKEN=1 ', 'does not start (error while loading shared libraries: libstdc++.so.6)'],
  ] as const) {
    const h = harness();
    const own = ownOpenCode(h, join(h.base, 'person-bin'), prefix);
    h.machine.env.PATH = `${join(h.base, 'person-bin')}:${h.machine.env.PATH}`;
    const runtime = createOpenCodeRuntime(h.context, h.machine);
    assert.equal(probeOf(await runtime.probe()).missing, true);
    assert.equal(await runtime.install(), undefined);
    assert.equal(probeOf(await runtime.probe()).ready, true);
    const launched = (await runtime.launch(launchInput(h.home))) as LaunchedAgent;
    assert.equal(h.spawned[0]?.command, join(h.base, 'private', 'agent', 'node_modules', 'opencode-ai', 'bin', 'opencode'));
    await launched.stop();
    const said = h.logs.filter(({ message }) => message.includes(own) || message.startsWith('OpenCode 1')).map(({ message }) => message);
    assert.equal(said.length, 2, said.join('\n'));
    assert.equal(said[0], `The OpenCode at ${own} ${why}, so it is not used.`);
    assert.equal(said[1], `OpenCode 1.19.6 runs, installed by Frontier. The OpenCode at ${own} ${why}, so it is not used.`);
  }
});

test('an install that cannot reach the registry, or reaches it through an untrusted certificate, says so', async () => {
  const h = harness();
  const runtime = createOpenCodeRuntime(h.context, h.machine);
  h.machine.env.FAKE_NPM_FAIL = 'network';
  assert.equal(failureOf(await runtime.install()).message, "Installing OpenCode did not finish: this worker can't reach registry.npmjs.org (EAI_AGAIN), so npm cannot download OpenCode. Check the worker's network connection, and its proxy if it needs one: npm reads HTTPS_PROXY and its own `proxy` setting.");
  assert.match(probeOf(await runtime.probe()).reason ?? '', /^Installing OpenCode on this worker did not finish: this worker can't reach registry\.npmjs\.org/);
  h.advance(2 * 60 * 60_000);
  h.machine.env.FAKE_NPM_FAIL = 'certificate';
  assert.match(failureOf(await runtime.install()).message, /this worker reaches registry\.npmjs\.org only through a certificate npm does not trust \(UNABLE_TO_GET_ISSUER_CERT_LOCALLY\)/);
});

test("the npm beside the worker's Node is used before the PATH's, and the PATH's when there is none beside it", async () => {
  const h = harness();
  assert.equal(await createOpenCodeRuntime(h.context, h.machine).install(), undefined);
  const elsewhere = harness();
  rmSync(join(dirname(elsewhere.machine.execPath), 'npm'));
  assert.match(failureOf(await createOpenCodeRuntime(elsewhere.context, elsewhere.machine).install()).message, /the PATH's npm was run/);
});

test('launch runs opencode acp in the session directory with the model, variant and agent definition as config', async () => {
  const h = harness();
  const runtime = createOpenCodeRuntime(h.context, h.machine);
  await runtime.install();
  const directory = join(h.base, 'workspace');
  mkdirSync(directory);
  const launched = await runtime.launch(launchInput(directory, {
    model: { modelId: 'anthropic/claude-opus-5-5', settings: { variant: 'high' } },
    agentDefinition: '---\nname: Reviewer\ndescription: Reviews code\ntools: Read, Grep, LS\n---\nReview carefully.\n',
  }));
  assert.ok(launched && 'stream' in launched);
  assert.equal(h.spawned[0]?.cwd, directory);
  const [, created] = await request(launched, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } },
    { jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: directory, mcpServers: [] } },
  ]);
  const meta = (created?.result as { _meta: { config: string; cwd: string; fromWorker: string } })._meta;
  assert.deepEqual(JSON.parse(meta.config), {
    model: 'anthropic/claude-opus-5-5',
    agent: {
      reviewer: {
        mode: 'primary',
        description: 'Reviews code',
        prompt: 'Review carefully.',
        tools: { '*': false, read: true, grep: true, list: true },
        model: 'anthropic/claude-opus-5-5',
        variant: 'high',
      },
    },
    default_agent: 'reviewer',
  });
  assert.equal(meta.cwd, directory);
  assert.equal(meta.fromWorker, 'yes');
  await launched.stop();
});

test('launch merges over a config the worker already sets, and is refused while OpenCode is missing', async () => {
  const h = harness();
  const runtime = createOpenCodeRuntime(h.context, h.machine);
  assert.equal(failureOf(await runtime.launch(launchInput(h.home))).message, 'OpenCode is not installed on this worker yet. It is installed automatically, then the session starts.');
  await runtime.install();
  h.machine.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ provider: { ollama: { name: 'Ollama' } }, model: 'ollama/llama' });
  const launched = (await runtime.launch(launchInput(h.home, { model: { modelId: 'opencode/big-pickle', settings: {} } }))) as LaunchedAgent;
  const [, created] = await request(launched, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } },
    { jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: h.home, mcpServers: [] } },
  ]);
  assert.deepEqual(JSON.parse((created?.result as { _meta: { config: string } })._meta.config), { provider: { ollama: { name: 'Ollama' } }, model: 'opencode/big-pickle' });
  await launched.stop();
});

test('the launch config is empty for the default definition, and a variant alone sets the build agent', () => {
  const base = launchInput('/tmp');
  assert.deepEqual(launchConfig(base), {});
  assert.deepEqual(launchConfig({ ...base, model: { modelId: 'opencode/big-pickle', settings: { variant: 'low' } } }), {
    model: 'opencode/big-pickle',
    agent: { build: { model: 'opencode/big-pickle', variant: 'low' } },
  });
  assert.deepEqual(launchConfig({ ...base, agentDefinition: '---\ndisallowed-tools: Bash, WebFetch\nmodel: anthropic/claude-sonnet-5\n---\n' }), {
    model: 'anthropic/claude-sonnet-5',
    agent: { 'frontier-session': { mode: 'primary', tools: { bash: false, webfetch: false }, model: 'anthropic/claude-sonnet-5' } },
    default_agent: 'frontier-session',
  });
});

test('a plain model list without details still gives models', () => {
  assert.deepEqual(toRuntimeModels(parseModels('opencode/big-pickle\nanthropic/claude-x\n')), [
    { label: 'Big Pickle (opencode)', versions: [{ id: 'opencode/big-pickle', label: 'big-pickle' }] },
    { label: 'Claude X (anthropic)', versions: [{ id: 'anthropic/claude-x', label: 'claude-x' }] },
  ]);
});
