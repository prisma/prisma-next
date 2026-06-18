import type { PslWorkflowProperty } from '@prisma-next/framework-components/psl-ast';

export function propertyMap(properties: readonly PslWorkflowProperty[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const property of properties) {
    out[property.name] = parseWorkflowPropertyValue(property.value);
  }
  return out;
}

export function stringProperty(
  properties: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = properties[key];
  return typeof value === 'string' ? value : undefined;
}

export function booleanProperty(properties: Record<string, unknown>, key: string): boolean {
  const value = properties[key];
  return typeof value === 'boolean' ? value : false;
}

export function stringListProperty(
  properties: Record<string, unknown>,
  key: string,
): readonly string[] {
  const value = properties[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export function parseWorkflowPropertyValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (isQuoted(trimmed)) {
    return unquote(trimmed);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return parseLooseObjectLiteral(trimmed);
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return parseLooseArrayLiteral(trimmed);
  }
  return trimmed;
}

function isQuoted(value: string): boolean {
  return (
    (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
  );
}

function unquote(value: string): string {
  const quote = value[0];
  const inner = value.slice(1, -1);
  if (quote === '"') {
    return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n');
  }
  return inner.replace(/\\'/g, "'").replace(/\\\\/g, '\\').replace(/\\n/g, '\n');
}

function parseLooseObjectLiteral(raw: string): Record<string, unknown> {
  const body = raw.slice(1, -1).trim();
  if (body.length === 0) return {};
  const out: Record<string, unknown> = {};
  for (const part of splitTopLevel(body, ',')) {
    const [keyRaw, ...valueParts] =
      splitTopLevel(part, ':').length > 1 ? splitTopLevel(part, ':') : splitTopLevel(part, '=');
    const key = keyRaw?.trim().replace(/^['"]|['"]$/g, '');
    const valueRaw = valueParts.join('=').trim();
    if (!key || valueRaw.length === 0) continue;
    out[key] = parseWorkflowPropertyValue(valueRaw);
  }
  return out;
}

function parseLooseArrayLiteral(raw: string): readonly unknown[] {
  const body = raw.slice(1, -1).trim();
  if (body.length === 0) return [];
  return splitTopLevel(body, ',').map((part) => parseWorkflowPropertyValue(part));
}

function splitTopLevel(value: string, delimiter: string): string[] {
  const parts: string[] = [];
  let quote: '"' | "'" | null = null;
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (quote) {
      if (character === quote && value[index - 1] !== '\\') quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '{' || character === '[' || character === '(') depth += 1;
    if (character === '}' || character === ']' || character === ')') depth -= 1;
    if (character === delimiter && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter((part) => part.length > 0);
}
