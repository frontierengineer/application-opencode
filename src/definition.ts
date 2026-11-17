export interface AgentDefinition {
  name: string | null;
  description: string | null;
  tools: string[] | null;
  disallowedTools: string[] | null;
  model: string | null;
  body: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function list(value: string | string[]): string[] {
  const items = Array.isArray(value) ? value : value.trim().replace(/^\[|\]$/g, '').split(',');
  return items.map(unquote).filter((item) => item.length > 0);
}

export function parseAgentDefinition(markdown: string): AgentDefinition {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const fields: Record<string, string | string[]> = {};
  let body = normalized;
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(normalized);
  if (match) {
    body = normalized.slice(match[0].length);
    let current: string | null = null;
    for (const line of (match[1] ?? '').split('\n')) {
      const item = /^\s+-\s+(.*)$/.exec(line);
      if (item && current) {
        const existing = fields[current];
        fields[current] = [...(Array.isArray(existing) ? existing : []), item[1] ?? ''];
        continue;
      }
      const pair = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
      if (!pair) continue;
      current = (pair[1] ?? '').toLowerCase().replace(/-/g, '');
      fields[current] = pair[2] ?? '';
    }
  }
  const scalar = (key: string): string | null => {
    const value = fields[key];
    if (value === undefined || Array.isArray(value)) return null;
    const text = unquote(value);
    return text === '' ? null : text;
  };
  const many = (key: string): string[] | null => {
    const value = fields[key];
    if (value === undefined || (!Array.isArray(value) && value.trim() === '')) return null;
    return list(value);
  };
  return {
    name: scalar('name'),
    description: scalar('description'),
    tools: many('tools'),
    disallowedTools: many('disallowedtools'),
    model: scalar('model'),
    body: body.trim(),
  };
}

export function isEmptyDefinition(definition: AgentDefinition): boolean {
  return definition.body === '' && definition.tools === null && definition.disallowedTools === null && definition.model === null;
}

export function agentName(definition: AgentDefinition): string {
  const cleaned = (definition.name ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned === '' || cleaned === 'default' ? 'frontier-session' : cleaned;
}
