import type { PslAttribute, PslAttributeArgument } from '@prisma-next/psl-parser';

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

function parseFieldList(value: string): readonly string[] {
  const inner = value.replace(/^\[/, '').replace(/\]$/, '').trim();
  if (inner.length === 0) return [];
  return inner.split(',').map((s) => s.trim());
}

export function getPositionalArgument(attribute: PslAttribute, index = 0): string | undefined {
  const entries = attribute.args.filter((arg) => arg.kind === 'positional');
  return entries[index]?.value;
}

export function parseQuotedStringLiteral(value: string): string | undefined {
  const trimmed = value.trim();
  const match = trimmed.match(/^(['"])(.*)\1$/);
  if (!match) return undefined;
  return match[2] ?? '';
}

function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}
