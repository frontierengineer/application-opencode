import type { ConfigurationContext, RuntimeOnWorker } from '../../../application';
import { registration } from '../../surface.ts';
import translations from '../../translations.json';

const ok = <T>(value: T) => ({ ok: true as const, value });
const workers = [
  { id: 'w1', title: 'Laptop', connected: true },
  { id: 'w2', title: 'Build server', connected: true },
  { id: 'w3', title: 'Old desktop', connected: false },
  { id: 'w4', title: 'New box', connected: true },
];
const reports: Record<string, RuntimeOnWorker> = {
  w1: { workerId: 'w1', ready: true, reason: null, models: [{ label: 'Claude Opus', versions: [{ id: 'opus', label: 'Opus 5.5', contextWindow: 200000, settings: [] }] }, { label: 'Claude Sonnet', versions: [{ id: 'sonnet', label: 'Sonnet 5.5', contextWindow: null, settings: [] }] }] },
  w2: { workerId: 'w2', ready: false, reason: 'OpenCode at /usr/bin/opencode does not start: exit code 127. Reinstall it, or remove it so it is installed automatically.', models: [] },
  w3: { workerId: 'w3', ready: true, reason: null, models: [] },
};
const runtimeHandlers: ((change: { id: string; kind: string }) => void)[] = [];
const clipboard: string[] = [];

const context = {
  applicationId: 'github.com/frontierengineer/application-opencode',
  translate: (token: string) => (translations.en as Record<string, string>)[token] ?? token,
  workers: {
    list: async () => ok(workers.map((worker) => ({ id: worker.id, title: () => worker.title, isConnected: () => worker.connected }))),
    onChanged: () => ({ unsubscribe() {} }),
  },
  runtimes: {
    get: async (id: string) => ok({ id, title: 'OpenCode', options: [], on: (workerId: string) => reports[workerId] ?? null }),
    onChanged: (handler: (change: { id: string; kind: string }) => void) => {
      runtimeHandlers.push(handler);
      return { unsubscribe() {} };
    },
  },
  clipboard: { copy: async (text: string) => { clipboard.push(text); return ok(undefined); } },
} as unknown as ConfigurationContext;

Object.assign(window, {
  clipboard,
  mountView: () => registration.configuration.mount(context),
  signIn: (workerId: string) => {
    reports[workerId] = { workerId, ready: true, reason: null, models: [] };
    for (const handler of runtimeHandlers) handler({ id: 'github.com/frontierengineer/application-opencode', kind: 'changed' });
  },
});
