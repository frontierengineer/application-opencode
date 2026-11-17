import type { RuntimeLaunchInput } from '../../application';
import { agentName, isEmptyDefinition, parseAgentDefinition } from './definition.ts';

const toolNames: Record<string, string> = {
  read: 'read',
  write: 'write',
  edit: 'edit',
  multiedit: 'edit',
  bash: 'bash',
  grep: 'grep',
  glob: 'glob',
  ls: 'list',
  list: 'list',
  webfetch: 'webfetch',
  websearch: 'websearch',
  todowrite: 'todowrite',
  todoread: 'todoread',
  task: 'task',
  agent: 'task',
  notebookedit: 'edit',
};

export function openCodeTool(name: string): string {
  const key = name.trim().toLowerCase();
  return toolNames[key] ?? key;
}

function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function merge(base: unknown, over: unknown): unknown {
  if (!plain(base) || !plain(over)) return over === undefined ? base : over;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) merged[key] = merge(base[key], value);
  return merged;
}

export function launchConfig(input: RuntimeLaunchInput): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  const definition = parseAgentDefinition(input.agentDefinition);
  const variant = typeof input.model?.settings.variant === 'string' && input.model.settings.variant !== '' ? input.model.settings.variant : null;
  const model = input.model?.modelId ?? (definition.model && definition.model !== 'inherit' ? definition.model : null);
  if (model) config.model = model;
  const agent: Record<string, unknown> = {};
  if (!isEmptyDefinition(definition)) {
    agent.mode = 'primary';
    if (definition.description) agent.description = definition.description;
    if (definition.body !== '') agent.prompt = definition.body;
    const tools: Record<string, boolean> = {};
    if (definition.tools) {
      tools['*'] = false;
      for (const tool of definition.tools) tools[openCodeTool(tool)] = true;
    }
    for (const tool of definition.disallowedTools ?? []) tools[openCodeTool(tool)] = false;
    if (Object.keys(tools).length > 0) agent.tools = tools;
  }
  if (model && variant) {
    agent.model = model;
    agent.variant = variant;
  } else if (model && Object.keys(agent).length > 0) {
    agent.model = model;
  }
  if (Object.keys(agent).length > 0) {
    if (isEmptyDefinition(definition)) {
      config.agent = { build: agent };
    } else {
      const name = agentName(definition);
      config.agent = { [name]: agent };
      config.default_agent = name;
    }
  }
  return config;
}
