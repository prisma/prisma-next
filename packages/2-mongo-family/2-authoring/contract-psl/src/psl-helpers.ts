import type { PslAttribute, PslAttributeArgument } from '@prisma-next/psl-parser';
import { getPositionalArgument, parseQuotedStringLiteral } from '@prisma-next/psl-parser';

export { getPositionalArgument, parseQuotedStringLiteral };

export function getNamedArgument(attr: PslAttribute, name: string): string | undefined {
  const arg = attr.args.find((a) => a.kind === 'named' && a.name === name);
  return arg?.value;
}

export function parseFieldList(value: string): readonly string[] {
  const inner = value.replace(/^\[/, '').replace(/\]$/, '').trim();
  if (inner.length === 0) return [];
  return splitTopLevel(inner).map((s) => s.trim());
}

export interface ParsedIndexField {
  readonly name: string;
  readonly isWildcard: boolean;
  readonly direction?: number;
}

export function parseIndexFieldList(value: string): readonly ParsedIndexField[] {
  const segments = parseFieldList(value);
  return segments.map(parseIndexFieldSegment);
}

function parseIndexFieldSegment(segment: string): ParsedIndexField {
  const wildcardMatch = segment.match(/^wildcard\(\s*(.*?)\s*\)$/);
  if (wildcardMatch) {
    const scope = wildcardMatch[1] ?? '';
    return {
      name: scope.length > 0 ? `${scope}.$**` : '$**',
      isWildcard: true,
    };
  }

  const modifierMatch = segment.match(/^(\w+)\(\s*sort:\s*(\w+)\s*\)$/);
  if (modifierMatch) {
    const fieldName = modifierMatch[1] ?? segment;
    const sortValue = modifierMatch[2];
    return {
      name: fieldName,
      isWildcard: false,
      direction: sortValue === 'Desc' ? -1 : 1,
    };
  }

  return { name: segment, isWildcard: false };
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts;
}

export function lowerFirst(value: string): string {
  if (value.length === 0) return value;
  return value[0]?.toLowerCase() + value.slice(1);
}

export function getAttribute(
  attributes: readonly PslAttribute[],
  name: string,
): PslAttribute | undefined {
  return attributes.find((attr) => attr.name === name);
}

export function getMapName(attributes: readonly PslAttribute[]): string | undefined {
  const mapAttr = getAttribute(attributes, 'map');
  if (!mapAttr) return undefined;
  const arg = mapAttr.args[0];
  if (!arg) return undefined;
  return stripQuotes(arg.value);
}

export interface ParsedRelationAttribute {
  readonly relationName?: string;
  readonly fields?: readonly string[];
  readonly references?: readonly string[];
}

export function parseRelationAttribute(
  attributes: readonly PslAttribute[],
): ParsedRelationAttribute | undefined {
  const relationAttr = getAttribute(attributes, 'relation');
  if (!relationAttr) return undefined;

  let relationName: string | undefined;
  let fieldsArg: PslAttributeArgument | undefined;
  let referencesArg: PslAttributeArgument | undefined;

  for (const arg of relationAttr.args) {
    if (arg.kind === 'positional') {
      relationName = stripQuotes(arg.value);
    } else if (arg.name === 'name') {
      relationName = stripQuotes(arg.value);
    } else if (arg.name === 'fields') {
      fieldsArg = arg;
    } else if (arg.name === 'references') {
      referencesArg = arg;
    }
  }

  const fields = fieldsArg ? parseFieldList(fieldsArg.value) : undefined;
  const references = referencesArg ? parseFieldList(referencesArg.value) : undefined;

  return {
    ...(relationName !== undefined ? { relationName } : {}),
    ...(fields !== undefined ? { fields } : {}),
    ...(references !== undefined ? { references } : {}),
  };
}

function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}
