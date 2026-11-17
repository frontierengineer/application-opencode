import type { Failure } from '../../application';

export interface Translator {
  translate(token: string, language?: string): string;
}

export function text(context: Translator, token: string, values: Record<string, string | number> = {}): string {
  return context.translate(token).replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}

export function failure(message: string, retriable: boolean, field?: string): Failure {
  return field === undefined ? { ok: false, message, retriable } : { ok: false, message, retriable, field };
}
