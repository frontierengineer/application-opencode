import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type Command, type Machine, firstExecutable, lastLines, nodeAware, run, which } from './machine.ts';

// The npm beside the Node that runs this worker comes first: a Frontier build
// carries its own Node with npm, and a PATH's npm may belong to another Node.
export async function locateNpm(machine: Machine): Promise<Command | null> {
  const beside = dirname(machine.execPath);
  const found = (await firstExecutable([join(beside, 'npm'), join(beside, 'npm.cmd')]))
    ?? (await realpath(join(beside, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')).catch(() => null))
    ?? (await realpath(join(beside, 'node_modules', 'npm', 'bin', 'npm-cli.js')).catch(() => null))
    ?? (await which(machine, 'npm'));
  if (!found) return null;
  const real = await realpath(found).catch(() => found);
  if (real.endsWith('npm-cli.js')) return { command: machine.execPath, args: [real] };
  return nodeAware(machine, found);
}

// npm on a slow registry takes minutes; one that has stalled is killed.
const installTimeoutMilliseconds = 10 * 60 * 1000;

const networkCodes = ['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ERR_SOCKET_TIMEOUT', 'EPROTO'];
const certificateCodes = ['SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID'];
const defaultRegistry = 'registry.npmjs.org';

export type Unreached = { host: string; code: string; certificate: boolean };

export function unreachedRegistry(output: string): Unreached | null {
  const code = [...certificateCodes, ...networkCodes].find((candidate) => new RegExp(`\\b${candidate}\\b`).test(output));
  if (!code) return null;
  const host = /https?:\/\/([^/\s:'"]+)/.exec(output)?.[1] ?? defaultRegistry;
  return { host, code, certificate: certificateCodes.includes(code) };
}

export type InstallOutcome = { ok: true } | { ok: false; reason: string; unreached?: Unreached };

export async function npmInstall(machine: Machine, prefix: string, specification: string): Promise<InstallOutcome> {
  const npm = await locateNpm(machine);
  if (!npm) return { ok: false, reason: 'npm is not on this worker' };
  const ran = await run(machine, npm, ['install', '--prefix', prefix, '--no-audit', '--no-fund', '--no-update-notifier', '--loglevel=error', specification], { cwd: machine.env.HOME, timeoutMilliseconds: installTimeoutMilliseconds });
  if (ran.error) return { ok: false, reason: ran.error };
  if (ran.code !== 0) {
    const output = ran.stderr || ran.stdout;
    const reason = lastLines(output) || `npm exited with code ${ran.code}`;
    const unreached = unreachedRegistry(output);
    return unreached ? { ok: false, reason, unreached } : { ok: false, reason };
  }
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
