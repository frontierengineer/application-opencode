import type { ConfigurationContext, Runtime, Worker } from '../../application';
import { h, icon, style, withCode } from './dom.ts';
import { text } from './text.ts';

// The Design System draws everything here; this only bounds the line length.
const css = `
.runtime-status { max-inline-size: 64rem; }
.runtime-status :is(th, td) { vertical-align: top; }
`;

const shownModels = 6;
const workersIcon = 'M4 5h16v10H4zM8 19h8M12 15v4';

export interface StatusCopy {
  signInCommand: string;
}

type Tone = 'success' | 'warning' | 'muted';
type Row = { worker: Worker; tone: Tone; status: string; reason: string | null; models: string[] };

export function mountRuntimeStatus(context: ConfigurationContext, copy: StatusCopy): void {
  const t = (token: string, values: Record<string, string | number> = {}) => text(context, token, values);
  const workersSection = h('section', { 'aria-labelledby': 'workers-heading' });
  const live = h('div', { role: 'status', 'data-tone': 'success' });
  let copied: number | undefined;

  const copyButton = h('button', {
    type: 'button',
    'data-size': 'small',
    onclick: async () => {
      const answer = await context.clipboard.copy(copy.signInCommand);
      live.dataset.tone = answer.ok ? 'success' : 'danger';
      live.textContent = answer.ok ? t('status.copied') : answer.message;
      window.clearTimeout(copied);
      copied = window.setTimeout(() => (live.textContent = ''), 4000);
    },
  }, t('status.copy'));

  document.body.append(
    style(css),
    h('frontier-stack', { class: 'runtime-status', padding: '5', gap: '6' },
      h('section', { 'aria-labelledby': 'about-heading' },
        h('frontier-stack', { gap: '2' },
          h('h3', { id: 'about-heading' }, t('status.about_heading')),
          h('p', {}, ...withCode(t('status.about'))),
        ),
      ),
      workersSection,
      h('section', { 'aria-labelledby': 'signin-heading' },
        h('frontier-stack', { gap: '3' },
          h('h3', { id: 'signin-heading' }, t('status.signin_heading')),
          h('ol', {},
            h('li', {}, ...withCode(t('status.signin_step_terminal'))),
            h('li', {}, h('frontier-row', { wrap: true }, h('span', {}, t('status.signin_step_run')), h('code', {}, copy.signInCommand), copyButton)),
            h('li', {}, ...withCode(t('status.signin_step_done'))),
          ),
          h('p', {}, h('small', {}, ...withCode(t('status.signin_alternative')))),
          live,
        ),
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

  // A worker can offer hundreds of models; the first few show, and the rest
  // are a disclosure away.
  function modelsCell(models: string[]): HTMLElement {
    if (models.length === 0) return h('small', { 'data-tone': 'muted' }, t('status.no_models'));
    const badges = (labels: string[]) => h('frontier-row', { wrap: true, gap: '1' }, ...labels.map((label) => h('frontier-badge', {}, label)));
    if (models.length <= shownModels) return badges(models);
    return h('frontier-stack', { gap: '1', align: 'start' },
      badges(models.slice(0, shownModels)),
      h('details', {}, h('summary', {}, t('status.more_models', { count: models.length - shownModels })), badges(models.slice(shownModels))),
    );
  }

  async function draw(): Promise<void> {
    const [workers, runtime] = await Promise.all([context.workers.list(), context.runtimes.get(context.applicationId)]);
    const heading = h('h3', { id: 'workers-heading' }, t('status.workers_heading'));
    if (!workers.ok) {
      workersSection.replaceChildren(h('frontier-stack', { gap: '3' }, heading, h('div', { role: 'alert' }, workers.message)));
      return;
    }
    if (workers.value.length === 0) {
      workersSection.replaceChildren(h('frontier-stack', { gap: '3' }, heading, h('frontier-empty', {},
        icon(workersIcon),
        h('h4', {}, t('status.no_workers_heading')),
        h('p', {}, t('status.no_workers')),
        h('button', { type: 'button', onclick: () => redraw() }, t('status.check_again')),
      )));
      return;
    }
    const rows = workers.value.map((worker) => rowFor(worker, runtime.ok ? runtime.value : null));
    workersSection.replaceChildren(h('frontier-stack', { gap: '3' },
      heading,
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col' }, t('status.column_worker')),
          h('th', { scope: 'col' }, t('status.column_status')),
          h('th', { scope: 'col' }, t('status.column_models')),
        )),
        h('tbody', {}, ...rows.map((row) => h('tr', {},
          h('th', { scope: 'row' }, row.worker.title()),
          h('td', {},
            h('frontier-stack', { gap: '1', align: 'start' },
              h('frontier-badge', { 'data-tone': row.tone }, row.status),
              row.reason ? h('small', {}, ...withCode(row.reason)) : null,
            ),
          ),
          h('td', {}, modelsCell(row.models)),
        ))),
      ),
      runtime.ok ? null : h('div', { role: 'alert' }, runtime.message),
    ));
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
