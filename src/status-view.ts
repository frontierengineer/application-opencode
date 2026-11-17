import type { ConfigurationContext, Runtime, Worker } from '../../application';
import { h, style, withCode } from './dom.ts';
import { text } from './text.ts';

const css = `
.runtime-status { display: grid; gap: var(--frontier-space-5, 24px); max-width: 64rem; padding: var(--frontier-space-4, 16px); }
.runtime-status section { display: grid; gap: var(--frontier-space-3, 12px); }
.runtime-status > *, .runtime-status section > *, .runtime-status li > *, .runtime-status td > * { margin-block: 0; }
.runtime-status table { width: 100%; border-collapse: collapse; }
.runtime-status th, .runtime-status td { text-align: start; vertical-align: top; padding: var(--frontier-space-2, 8px) var(--frontier-space-3, 12px); }
.runtime-status tbody tr:nth-child(odd) { background: var(--frontier-color-surface, rgba(127, 127, 127, 0.06)); }
.runtime-status .reason { color: var(--frontier-color-text-muted, inherit); margin: var(--frontier-space-1, 4px) 0 0; }
.runtime-status .chip { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 2px 10px; font-size: 0.875em; font-weight: 600; background: var(--frontier-color-fill, rgba(127, 127, 127, 0.14)); }
.runtime-status .chip::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.runtime-status .chip[data-tone="success"] { color: var(--frontier-color-success, #2f9e44); }
.runtime-status .chip[data-tone="warning"] { color: var(--frontier-color-warning, #b8860b); }
.runtime-status .chip[data-tone="muted"] { color: var(--frontier-color-text-muted, #777); }
.runtime-status .models { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; }
.runtime-status .command { display: flex; gap: var(--frontier-space-2, 8px); align-items: center; flex-wrap: wrap; }
.runtime-status .command code { padding: 4px 8px; border-radius: 6px; background: var(--frontier-color-fill, rgba(127, 127, 127, 0.14)); }
.runtime-status .empty { display: grid; justify-items: start; gap: var(--frontier-space-2, 8px); padding: var(--frontier-space-5, 24px); border-radius: 12px; background: var(--frontier-color-surface, rgba(127, 127, 127, 0.06)); }
`;

export interface StatusCopy {
  signInCommand: string;
}

type Row = { worker: Worker; tone: 'success' | 'warning' | 'muted'; status: string; reason: string | null; models: string[] };

export function mountRuntimeStatus(context: ConfigurationContext, copy: StatusCopy): void {
  const t = (token: string, values: Record<string, string | number> = {}) => text(context, token, values);
  const tableBody = h('tbody');
  const workersSection = h('section', { 'aria-labelledby': 'workers-heading' });
  const live = h('p', { role: 'status', class: 'reason' });
  let copied: number | undefined;

  const copyButton = h('button', {
    type: 'button',
    onclick: async () => {
      const answer = await context.clipboard.copy(copy.signInCommand);
      live.textContent = answer.ok ? t('status.copied') : answer.message;
      window.clearTimeout(copied);
      copied = window.setTimeout(() => (live.textContent = ''), 4000);
    },
  }, t('status.copy'));

  document.body.append(
    style(css),
    h('main', { class: 'runtime-status' },
      h('section', { 'aria-labelledby': 'about-heading' },
        h('h2', { id: 'about-heading' }, t('status.about_heading')),
        h('p', {}, ...withCode(t('status.about'))),
      ),
      workersSection,
      h('section', { 'aria-labelledby': 'signin-heading' },
        h('h2', { id: 'signin-heading' }, t('status.signin_heading')),
        h('ol', {},
          h('li', {}, ...withCode(t('status.signin_step_terminal'))),
          h('li', {}, h('div', { class: 'command' }, h('span', {}, t('status.signin_step_run')), h('code', {}, copy.signInCommand), copyButton)),
          h('li', {}, ...withCode(t('status.signin_step_done'))),
        ),
        h('p', {}, ...withCode(t('status.signin_alternative'))),
        live,
      ),
    ),
  );

  function rowFor(worker: Worker, runtime: Runtime | null): Row {
    const report = runtime?.on(worker.id) ?? null;
    const models = report?.models.flatMap((model) => model.versions.map((version) => version.label)) ?? [];
    if (!worker.isConnected()) return { worker, tone: 'muted', status: t('status.offline'), reason: report?.reason ?? null, models };
    if (report === null) return { worker, tone: 'muted', status: t('status.not_reported'), reason: t('status.not_reported_reason'), models };
    if (report.ready) return { worker, tone: 'success', status: t('status.ready'), reason: null, models };
    return { worker, tone: 'warning', status: t('status.not_ready'), reason: report.reason, models };
  }

  async function draw(): Promise<void> {
    const [workers, runtime] = await Promise.all([context.workers.list(), context.runtimes.get(context.applicationId)]);
    workersSection.replaceChildren(h('h2', { id: 'workers-heading' }, t('status.workers_heading')));
    if (!workers.ok) {
      workersSection.append(h('p', { role: 'alert' }, workers.message));
      return;
    }
    if (workers.value.length === 0) {
      workersSection.append(h('div', { class: 'empty' },
        h('h3', {}, t('status.no_workers_heading')),
        h('p', {}, t('status.no_workers')),
      ));
      return;
    }
    const rows = workers.value.map((worker) => rowFor(worker, runtime.ok ? runtime.value : null));
    tableBody.replaceChildren(...rows.map((row) => h('tr', {},
      h('th', { scope: 'row' }, row.worker.title()),
      h('td', {},
        h('span', { class: 'chip', 'data-tone': row.tone }, row.status),
        row.reason ? h('p', { class: 'reason' }, ...withCode(row.reason)) : null,
      ),
      h('td', {}, row.models.length > 0
        ? h('ul', { class: 'models' }, ...row.models.map((label) => h('li', {}, label)))
        : h('span', { class: 'reason' }, t('status.no_models'))),
    )));
    workersSection.append(h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, t('status.column_worker')),
        h('th', { scope: 'col' }, t('status.column_status')),
        h('th', { scope: 'col' }, t('status.column_models')),
      )),
      tableBody,
    ));
    if (!runtime.ok) workersSection.append(h('p', { role: 'alert' }, runtime.message));
  }

  let pending = false;
  const redraw = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      void draw();
    });
  };
  context.runtimes.onChanged((change) => {
    if (change.id === context.applicationId) redraw();
  });
  context.workers.onChanged(redraw);
  redraw();
}
