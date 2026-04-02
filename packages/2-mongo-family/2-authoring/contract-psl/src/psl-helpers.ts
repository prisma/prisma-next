import type { PslAttribute, PslAttributeArgument } from '@prisma-next/psl-parser';

export function lowerFirst(value: string): string {
  if (value.length === 0) return value;
  return value[0]!.toLowerCase() + value.slice(1);
}

export function getAttribute(
  attributes: readonly PslAttribute[],
  name: string,
): PslAttribute | undefined {
  return attributes.find((attr) => attr.name === name);
}

export function parseMapName(attributes: readonly PslAttribute[]): string | undefined {
  const mapAttr = getAttribute(attributes, '@@map');
  if (!mapAttr) return undefined;
  const arg = mapAttr.args[0];
  if (!arg) return undefined;
  return stripQuotes(arg.value);
}

export function parseRelationAttribute(attributes: readonly PslAttribute[]):
  | {
      fields: readonly string[];
      references: readonly string[];
    }
  | undefined {
  const relationAttr = getAttribute(attributes, '@relation');
  if (!relationAttr) return undefined;

  let fieldsArg: PslAttributeArgument | undefined;
  let referencesArg: PslAttributeArgument | undefined;

  for (const arg of relationAttr.args) {
    if (arg.kind === 'named' && arg.name === 'fields') fieldsArg = arg;
    if (arg.kind === 'named' && arg.name === 'references') referencesArg = arg;
  }

  if (!fieldsArg || !referencesArg) return undefined;

  return {
    fields: parseFieldList(fieldsArg.value),
    references: parseFieldList(referencesArg.value),
  };
}

function parseFieldList(value: string): readonly string[] {
  const inner = value.replace(/^\[/, '').replace(/\]$/, '').trim();
  if (inner.length === 0) return [];
  return inner.split(',').map((s) => s.trim());
}

function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}
