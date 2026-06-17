import type { ExpressionAst, ResolvedAttribute } from '@prisma-next/psl-parser/syntax';
import { argText, StringLiteralExprAst } from '@prisma-next/psl-parser/syntax';

/**
 * Unquoted value of a string-literal argument, or `undefined` when the
 * expression is not a string literal. Handles both `'`- and `"`-quoting and
 * decodes escapes, unlike the raw {@link argText} slice.
 */
function stringLiteralValue(value: ExpressionAst): string | undefined {
  return StringLiteralExprAst.cast(value.syntax)?.value();
}

export function getNamedArgument(attr: ResolvedAttribute, name: string): string | undefined {
  const arg = attr.args.find((a) => a.name === name);
  return arg === undefined ? undefined : argText(arg.value);
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
  attributes: readonly ResolvedAttribute[],
  name: string,
): ResolvedAttribute | undefined {
  return attributes.find((attr) => attr.name === name);
}

export function getMapName(attributes: readonly ResolvedAttribute[]): string | undefined {
  const mapAttr = getAttribute(attributes, 'map');
  if (!mapAttr) return undefined;
  const arg = mapAttr.positionalArg(0);
  if (!arg) return undefined;
  return stringLiteralValue(arg);
}

export interface ParsedRelationAttribute {
  readonly relationName?: string;
  readonly fields?: readonly string[];
  readonly references?: readonly string[];
}

export function parseRelationAttribute(
  attributes: readonly ResolvedAttribute[],
): ParsedRelationAttribute | undefined {
  const relationAttr = getAttribute(attributes, 'relation');
  if (!relationAttr) return undefined;

  let relationName: string | undefined;
  let fieldsArg: ExpressionAst | undefined;
  let referencesArg: ExpressionAst | undefined;

  for (const arg of relationAttr.args) {
    if (arg.name === undefined) {
      relationName = stringLiteralValue(arg.value);
    } else if (arg.name === 'name') {
      relationName = stringLiteralValue(arg.value);
    } else if (arg.name === 'fields') {
      fieldsArg = arg.value;
    } else if (arg.name === 'references') {
      referencesArg = arg.value;
    }
  }

  const fields = fieldsArg ? parseFieldList(argText(fieldsArg)) : undefined;
  const references = referencesArg ? parseFieldList(argText(referencesArg)) : undefined;

  return {
    ...(relationName !== undefined ? { relationName } : {}),
    ...(fields !== undefined ? { fields } : {}),
    ...(references !== undefined ? { references } : {}),
  };
}

/**
 * Reads a positional argument as an unquoted string literal: a value wrapped in
 * matching single or double quotes yields its inner text, anything else yields
 * `undefined`. Used for `@@base`'s discriminator value, which must be a quoted
 * string.
 */
export function quotedStringArg(attr: ResolvedAttribute, index: number): string | undefined {
  const value = attr.positionalArg(index);
  if (value === undefined) return undefined;
  const trimmed = argText(value).trim();
  const match = trimmed.match(/^(['"])(.*)\1$/);
  if (!match) return undefined;
  return match[2] ?? '';
}
