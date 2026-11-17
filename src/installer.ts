import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type Command, type Machine, firstExecutable, lastLines, nodeAware, run, which } from './machine.ts';

export async function locateNpm(machine: Machine): Promise<Command | null> {
  const beside = dirname(machine.execPath);
  const found = (await which(machine, 'npm'))
    ?? (await firstExecutable([join(beside, 'npm'), join(beside, 'npm.cmd')]));
  if (found) {
    const real = await realpath(found).catch(() => found);
    if (real.endsWith('npm-cli.js')) return { command: machine.execPath, args: [real] };
    return nodeAware(machine, found);
  }
  const cli = join(beside, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  try {
    return { command: machine.execPath, args: [await realpath(cli)] };
  } catch {
    return null;
  }
}

export type InstallOutcome = { ok: true } | { ok: false; reason: string };

export async function npmInstall(machine: Machine, prefix: string, specification: string): Promise<InstallOutcome> {
  const npm = await locateNpm(machine);
  if (!npm) return { ok: false, reason: 'npm is not on this worker' };
  const ran = await run(machine, npm, ['install', '--prefix', prefix, '--no-audit', '--no-fund', '--no-update-notifier', '--loglevel=error', specification], { cwd: machine.env.HOME });
  if (ran.error) return { ok: false, reason: ran.error };
  if (ran.code !== 0) return { ok: false, reason: lastLines(ran.stderr || ran.stdout) || `npm exited with code ${ran.code}` };
  return { ok: true };
}

export interface InstallFailure {
  message: string;
  at: number;
  retryAt: number;
}

export class Installer {
  private running: Promise<InstallOutcome> | null = null;
  private failures = 0;
  private last: InstallFailure | null = null;
  private readonly machine: Machine;
  constructor(machine: Machine) {
    this.machine = machine;
  }

  get busy(): boolean {
    return this.running !== null;
  }

  failure(): InstallFailure | null {
    return this.last && this.machine.now() < this.last.retryAt ? this.last : null;
  }

  async run(work: () => Promise<InstallOutcome>): Promise<InstallOutcome> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        const outcome = await work();
        if (outcome.ok) {
          this.failures = 0;
          this.last = null;
        } else {
          this.failures += 1;
          const minutes = Math.min(60, 4 ** (this.failures - 1));
          const at = this.machine.now();
          this.last = { message: outcome.reason, at, retryAt: at + minutes * 60_000 };
        }
        return outcome;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }
}
