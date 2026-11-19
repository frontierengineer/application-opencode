import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realMachine, run } from '../src/machine.ts';

test('a command that runs too long is killed and answered as not finished', async () => {
  const started = Date.now();
  const ran = await run(realMachine, { command: process.execPath, args: ['-e', 'setTimeout(() => {}, 60_000)'] }, [], { timeoutMilliseconds: 300 });
  assert.equal(ran.code, null);
  assert.match(ran.error ?? '', /did not finish within/);
  assert.ok(Date.now() - started < 10_000);
});

test('a command that finishes in time answers its output and exit code', async () => {
  const ran = await run(realMachine, { command: process.execPath, args: ['-e', 'process.stdout.write("out"); process.exit(3)'] }, [], { timeoutMilliseconds: 10_000 });
  assert.deepEqual({ code: ran.code, stdout: ran.stdout, error: ran.error }, { code: 3, stdout: 'out', error: null });
});
