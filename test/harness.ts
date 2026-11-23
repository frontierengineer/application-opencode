import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Result, RuntimeContext, SpawnAgentOptions, SpawnedAgent } from '../../application';
import type { Machine } from '../src/machine.ts';

const here = dirname(fileURLToPath(import.meta.url));
const translations = JSON.parse(readFileSync(join(here, '..', 'translations.json'), 'utf8')) as Record<string, Record<string, string>>;

export interface Harness {
  context: RuntimeContext;
  machine: Machine;
  base: string;
  home: string;
  fakeBin: string;
  spawned: SpawnAgentOptions[];
  logs: { level: string; message: string }[];
  advance(milliseconds: number): void;
}

export function harness(): Harness {
  const base = mkdtempSync(join(tmpdir(), 'opencode-test-'));
  const home = join(base, 'home');
  const fakeBin = join(base, 'bin');
  for (const directory of [home, fakeBin, join(base, 'private'), join(base, 'scratch')]) mkdirSync(directory, { recursive: true });
  const carried = join(base, 'node', 'bin');
  mkdirSync(carried, { recursive: true });
  symlinkSync(process.execPath, join(carried, 'node'));
  writeFileSync(join(carried, 'npm'), `#!/bin/sh\nexec "${process.execPath}" "${join(here, 'fixtures', 'fake-npm.mjs')}" "$@"\n`);
  chmodSync(join(carried, 'npm'), 0o755);
  writeFileSync(join(fakeBin, 'npm'), '#!/bin/sh\necho "the PATH\'s npm was run" >&2\nexit 1\n');
  chmodSync(join(fakeBin, 'npm'), 0o755);
  let clock = Date.parse('2026-11-17T12:00:00Z');
  const machine: Machine = {
    env: { PATH: `${fakeBin}:/usr/bin:/bin`, HOME: home },
    platform: 'linux',
    execPath: join(carried, 'node'),
    now: () => clock,
  };
  const spawned: SpawnAgentOptions[] = [];
  const logs: { level: string; message: string }[] = [];
  const log = (level: string) => async (message: string) => {
    logs.push({ level, message });
  };
  const context = {
    applicationId: 'github.com/frontierengineer/application-opencode',
    directories: { private: join(base, 'private'), scratch: join(base, 'scratch') },
    translate: (token: string) => translations.en?.[token] ?? token,
    logger: { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') },
    spawnAgent: async (options: SpawnAgentOptions): Promise<Result<SpawnedAgent>> => {
      spawned.push(options);
      return { ok: true, value: spawnLines(options, machine) };
    },
  } as unknown as RuntimeContext;
  return { context, machine, base, home, fakeBin, spawned, logs, advance: (milliseconds) => (clock += milliseconds) };
}

export function spawnLines(options: SpawnAgentOptions, machine: Machine): SpawnedAgent {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: { ...machine.env, ...options.environment },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const exited = new Promise<void>((done) => child.on('exit', () => done()));
  const readable = new ReadableStream<object>({
    start(controller) {
      let buffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line.trim() !== '') controller.enqueue(JSON.parse(line) as object);
        }
      });
      child.stdout.on('end', () => controller.close());
    },
  });
  const writable = new WritableStream<object>({
    write(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    close() {
      child.stdin.end();
    },
  });
  return {
    stream: { readable, writable },
    stop: async () => {
      child.kill('SIGTERM');
      await exited;
    },
  };
}

export async function request(agent: SpawnedAgent, messages: object[]): Promise<Record<string, unknown>[]> {
  const writer = agent.stream.writable.getWriter();
  const reader = agent.stream.readable.getReader();
  const answers: Record<string, unknown>[] = [];
  for (const message of messages) {
    await writer.write(message);
    const next = await reader.read();
    if (next.done) break;
    answers.push(next.value as Record<string, unknown>);
  }
  writer.releaseLock();
  reader.releaseLock();
  return answers;
}

export async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean, attempts = 100): Promise<T> {
  let value = await read();
  for (let attempt = 0; attempt < attempts && !done(value); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    value = await read();
  }
  return value;
}
