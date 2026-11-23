import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  Failure,
  LaunchedAgent,
  RuntimeContext,
  RuntimeImplementation,
  RuntimeLaunchInput,
  RuntimeModel,
  RuntimeProbe,
  Unavailable,
} from '../../application';
import { launchConfig, merge } from './config.ts';
import { type InstallOutcome, Installer, npmInstall } from './installer.ts';
import { type Command, type Machine, firstExecutable, homeOf, lastLines, nodeAware, realMachine, run, which } from './machine.ts';
import { parseModels, toRuntimeModels } from './models.ts';
import { failure, text } from './text.ts';
import { judgeVersion } from './version.ts';

export const agentPackage = 'opencode-ai';
export const agentVersion = '1.19.6';
// An OpenCode the person installed older than this, or of another major
// version, is passed over for the one installed at agentVersion.
export const agentMinimum = '1.19.6';

const refreshAfterMilliseconds = 12 * 60 * 60 * 1000;
const retryRefreshAfterMilliseconds = 10 * 60 * 1000;

interface Binary {
  command: Command;
  path: string;
}

interface ModelCache {
  key: string;
  at: number;
  models: RuntimeModel[];
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function createOpenCodeRuntime(context: RuntimeContext, machine: Machine = realMachine): RuntimeImplementation {
  const t = (token: string, values: Record<string, string | number> = {}) => text(context, token, values);
  const prefix = join(context.directories.private, 'agent');
  const cachePath = join(context.directories.private, 'models.json');
  const installer = new Installer(machine);
  const versions = new Map<string, { mtime: number; version: string | null; problem: string | null }>();
  let cache: ModelCache | null | undefined;
  let refreshing: Promise<void> | null = null;
  let refreshFailedAt = 0;

  const dataDirectory = () => join(machine.env.XDG_DATA_HOME || join(homeOf(machine), '.local', 'share'), 'opencode');

  async function privateBinary(): Promise<Binary | null> {
    const pkg = await readJson(join(prefix, 'node_modules', agentPackage, 'package.json'));
    if (!pkg || pkg.version !== agentVersion) return null;
    const path = join(prefix, 'node_modules', '.bin', machine.platform === 'win32' ? 'opencode.cmd' : 'opencode');
    if (!existsSync(path)) return null;
    return { command: await nodeAware(machine, path), path };
  }

  let said = '';
  function say(key: string, message: string, fields: Record<string, string>): void {
    if (key === said) return;
    said = key;
    void context.logger.info(message, fields);
  }

  async function locate(): Promise<Binary | null> {
    const found = (await which(machine, 'opencode')) ?? (await firstExecutable([join(homeOf(machine), '.opencode', 'bin', 'opencode')]));
    let passedOver = '';
    if (found) {
      const own: Binary = { command: await nodeAware(machine, found), path: found };
      const checked = await check(own);
      const verdict = checked.problem === null ? judgeVersion(checked.version, agentMinimum) : null;
      if (verdict?.usable) {
        say(`own ${found} ${checked.version}`, t('log.own', { version: checked.version ?? '', path: found }), { path: found, version: checked.version ?? '' });
        return own;
      }
      const values = { version: checked.version ?? '', path: found, minimum: agentMinimum, reason: checked.problem ?? '' };
      passedOver = verdict === null ? t('log.passed_over_broken', values)
        : verdict.why === 'older' ? t('log.passed_over_older', values)
          : verdict.why === 'newer_major' ? t('log.passed_over_newer_major', values)
            : t('log.passed_over_unknown', values);
    }
    const installed = await privateBinary();
    if (installed) say(`private ${installed.path} ${passedOver}`, [t('log.private', { version: agentVersion }), passedOver].filter(Boolean).join(' '), { path: installed.path, version: agentVersion });
    else if (passedOver) say(`none ${passedOver}`, passedOver, { path: found ?? '' });
    return installed;
  }

  async function check(binary: Binary): Promise<{ version: string | null; problem: string | null }> {
    const mtime = (await stat(binary.command.args[0] ?? binary.command.command).catch(() => null))?.mtimeMs ?? 0;
    const known = versions.get(binary.path);
    if (known && known.mtime === mtime) return known;
    const ran = await run(machine, binary.command, ['--version'], { timeoutMilliseconds: 15_000 });
    const version = ran.code === 0 ? ran.stdout.trim().split('\n').pop() ?? null : null;
    const problem = ran.code === 0 ? null : ran.error ?? (lastLines(ran.stderr || ran.stdout) || `exit code ${ran.code}`);
    const result = { mtime, version, problem };
    versions.set(binary.path, result);
    return result;
  }

  async function authStamp(): Promise<number> {
    return (await stat(join(dataDirectory(), 'auth.json')).catch(() => null))?.mtimeMs ?? 0;
  }

  async function loadCache(): Promise<ModelCache | null> {
    if (cache === undefined) {
      const stored = await readJson(cachePath);
      cache = stored && typeof stored.key === 'string' && Array.isArray(stored.models) ? (stored as unknown as ModelCache) : null;
    }
    return cache;
  }

  function refreshModels(binary: Binary, key: string, force = false): Promise<void> {
    if (refreshing) return refreshing;
    if (!force && machine.now() - refreshFailedAt < retryRefreshAfterMilliseconds) return Promise.resolve();
    refreshing = (async () => {
      try {
        let ran = await run(machine, binary.command, ['models', '--verbose'], { cwd: context.directories.scratch, timeoutMilliseconds: 60_000 });
        if (ran.code !== 0) ran = await run(machine, binary.command, ['models'], { cwd: context.directories.scratch, timeoutMilliseconds: 60_000 });
        if (ran.code !== 0) throw new Error(ran.error ?? (lastLines(ran.stderr) || `exit code ${ran.code}`));
        const models = toRuntimeModels(parseModels(ran.stdout));
        if (models.length === 0) throw new Error('OpenCode listed no models');
        cache = { key, at: machine.now(), models };
        await writeFile(cachePath, JSON.stringify(cache));
        refreshFailedAt = 0;
      } catch (error) {
        refreshFailedAt = machine.now();
        void context.logger.warn('OpenCode did not list its models', { reason: error instanceof Error ? error.message : String(error) });
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function currentModels(binary: Binary, version: string | null): Promise<RuntimeModel[]> {
    const key = `${version ?? 'unknown'}:${await authStamp()}`;
    const stored = await loadCache();
    const fresh = stored !== null && stored.key === key;
    if (!fresh || machine.now() - (stored?.at ?? 0) > refreshAfterMilliseconds) void refreshModels(binary, key);
    return stored ? stored.models : [];
  }

  async function probe(): Promise<RuntimeProbe | Failure | Unavailable> {
    try {
      if (installer.busy) return { ready: false, reason: t('probe.installing') };
      const binary = await locate();
      if (!binary) {
        const failed = installer.failure();
        if (failed) {
          const minutes = Math.max(1, Math.ceil((failed.retryAt - machine.now()) / 60_000));
          return { ready: false, reason: t('probe.install_failed', { reason: failed.message, minutes }) };
        }
        return { ready: false, missing: true, reason: t('probe.missing') };
      }
      const checked = await check(binary);
      if (checked.problem !== null) return { ready: false, reason: t('probe.broken', { path: binary.path, reason: checked.problem }) };
      const models = await currentModels(binary, checked.version);
      return models.length > 0 ? { ready: true, models } : { ready: true };
    } catch (error) {
      return failure(t('probe.could_not_run', { reason: error instanceof Error ? error.message : String(error) }), true);
    }
  }

  function installReason(outcome: Extract<InstallOutcome, { ok: false }>): string {
    if (!outcome.unreached) return outcome.reason;
    const { host, code, certificate } = outcome.unreached;
    return t(certificate ? 'install.untrusted_certificate' : 'install.unreachable', { host, code });
  }

  async function install(): Promise<void | Failure | Unavailable> {
    const outcome = await installer.run(async () => {
      await mkdir(prefix, { recursive: true });
      const installed = await npmInstall(machine, prefix, `${agentPackage}@${agentVersion}`);
      if (!installed.ok) return { ok: false, reason: installReason(installed) };
      if (!(await privateBinary())) return { ok: false, reason: t('install.not_found_after') };
      return { ok: true };
    });
    if (!outcome.ok) return failure(t('install.failed', { reason: outcome.reason }), true);
    void context.logger.info('Installed OpenCode', { package: `${agentPackage}@${agentVersion}` });
    const binary = await locate();
    if (binary) {
      const checked = await check(binary);
      void refreshModels(binary, `${checked.version ?? 'unknown'}:${await authStamp()}`, true);
    }
  }

  async function launch(input: RuntimeLaunchInput): Promise<LaunchedAgent | Failure | Unavailable> {
    const binary = await locate();
    if (!binary) return failure(t('launch.missing'), true);
    const environment: Record<string, string> = { ...input.environment };
    let config: unknown = launchConfig(input);
    const existing = input.environment.OPENCODE_CONFIG_CONTENT ?? machine.env.OPENCODE_CONFIG_CONTENT;
    if (existing) {
      try {
        config = merge(JSON.parse(existing), config);
      } catch {
        void context.logger.warn('OPENCODE_CONFIG_CONTENT on this worker is not JSON, so it was replaced for this session');
      }
    }
    if (Object.keys(config as Record<string, unknown>).length > 0) environment.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
    const spawned = await context.spawnAgent({
      command: binary.command.command,
      args: [...binary.command.args, 'acp'],
      cwd: input.directory,
      environment,
    });
    if (!spawned.ok) return spawned;
    return spawned.value;
  }

  return { probe, install, launch };
}
