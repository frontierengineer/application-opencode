import { spawn } from 'node:child_process';
import { access, constants, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

export interface Machine {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  execPath: string;
  now(): number;
}

export const realMachine: Machine = {
  env: process.env,
  platform: process.platform,
  execPath: process.execPath,
  now: () => Date.now(),
};

export function homeOf(machine: Machine): string {
  return machine.env.HOME || machine.env.USERPROFILE || homedir();
}

export function expandHome(machine: Machine, path: string): string {
  if (path === '~') return homeOf(machine);
  if (path.startsWith('~/')) return join(homeOf(machine), path.slice(2));
  return path;
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function which(machine: Machine, name: string): Promise<string | null> {
  const extensions = machine.platform === 'win32' ? (machine.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const directory of (machine.env.PATH ?? '').split(delimiter)) {
    if (directory === '') continue;
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension.toLowerCase()}`);
      if (await executable(candidate)) return candidate;
    }
  }
  return null;
}

export async function firstExecutable(paths: readonly string[]): Promise<string | null> {
  for (const path of paths) if (await executable(path)) return path;
  return null;
}

export interface Command {
  command: string;
  args: string[];
}

export async function nodeAware(machine: Machine, path: string): Promise<Command> {
  const real = await realpath(path).catch(() => path);
  return /\.(c|m)?js$/.test(real) ? { command: machine.execPath, args: [real] } : { command: real, args: [] };
}

export interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
  error: string | null;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  // Killed when it runs longer, and answered with an error saying so.
  timeoutMilliseconds: number;
}

export function run(machine: Machine, command: Command, args: readonly string[], options: RunOptions): Promise<Ran> {
  return new Promise((done) => {
    const path = [dirname(machine.execPath), machine.env.PATH ?? ''].filter(Boolean).join(delimiter);
    const child = spawn(command.command, [...command.args, ...args], {
      cwd: options.cwd ?? homeOf(machine),
      env: { ...machine.env, PATH: path, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (ran: Ran) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      done(ran);
    };
    const deadline = setTimeout(() => {
      child.kill('SIGKILL');
      settle({ code: null, stdout, stderr, error: `it did not finish within ${Math.round(options.timeoutMilliseconds / 1000)} s` });
    }, options.timeoutMilliseconds);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', (error) => settle({ code: null, stdout, stderr, error: error.message }));
    child.on('close', (code) => settle({ code, stdout, stderr, error: null }));
  });
}

export function lastLines(text: string, count = 3): string {
  return text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0).slice(-count).join(' ').slice(0, 400);
}
