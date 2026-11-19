import type { Field, RuntimeModel, RuntimeModelVersion } from '../../application';

interface ListedModel {
  id: string;
  providerID: string;
  name?: string;
  family?: string;
  status?: string;
  release_date?: string;
  limit?: { context?: number };
  variants?: Record<string, unknown>;
}

export function parseModels(output: string): ListedModel[] {
  const models: ListedModel[] = [];
  const lines = output.split('\n');
  let index = 0;
  while (index < lines.length) {
    const header = (lines[index] ?? '').trim();
    index += 1;
    const match = /^([^\s/{}]+)\/(\S+)$/.exec(header);
    if (!match) continue;
    const json: string[] = [];
    while (index < lines.length && !/^[^\s/{}]+\/\S+$/.test((lines[index] ?? '').trim())) {
      json.push(lines[index] ?? '');
      index += 1;
    }
    const text = json.join('\n').trim();
    let detail: Partial<ListedModel> = {};
    if (text.startsWith('{')) {
      try {
        detail = JSON.parse(text) as Partial<ListedModel>;
      } catch {
        detail = {};
      }
    }
    models.push({ ...detail, id: match[2]!, providerID: match[1]! });
  }
  return models;
}

function words(value: string): string {
  return value.split(/[-_\s]+/).filter(Boolean).map((word) => `${word[0]!.toUpperCase()}${word.slice(1)}`).join(' ');
}

export function variantField(variants: readonly string[]): Field {
  return {
    type: 'select',
    key: 'variant',
    label: 'Variant',
    description: 'How much the model reasons before it answers.',
    choices: variants.map((variant) => ({ value: variant, label: words(variant) })),
  };
}

export function toRuntimeModels(listed: readonly ListedModel[]): RuntimeModel[] {
  const groups = new Map<string, { provider: string; label: string; versions: { released: string; version: RuntimeModelVersion }[] }>();
  for (const model of listed) {
    if (model.status === 'deprecated') continue;
    const family = model.family && model.family !== '' ? model.family : model.id;
    const key = `${model.providerID}/${family}`;
    const group = groups.get(key) ?? { provider: model.providerID, label: `${words(family)} (${model.providerID})`, versions: [] };
    const version: RuntimeModelVersion = { id: `${model.providerID}/${model.id}`, label: model.name ?? model.id };
    if (typeof model.limit?.context === 'number' && model.limit.context > 0) version.contextWindow = model.limit.context;
    const variants = Object.keys(model.variants ?? {});
    if (variants.length > 0) version.settings = [variantField(variants)];
    if (!group.versions.some((existing) => existing.version.id === version.id)) group.versions.push({ released: model.release_date ?? '', version });
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => (a.provider === b.provider ? a.label.localeCompare(b.label) : a.provider === 'opencode' ? -1 : b.provider === 'opencode' ? 1 : a.provider.localeCompare(b.provider)))
    .map((group) => ({ label: group.label, versions: group.versions.sort((a, b) => b.released.localeCompare(a.released)).map((entry) => entry.version) }));
}
