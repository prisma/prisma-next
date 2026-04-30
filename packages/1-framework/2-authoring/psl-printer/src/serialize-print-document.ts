import type { PrintDocument } from './print-document';
import type { PrinterField, PrinterNamedType } from './types';

const PSL_IDENTIFIER_PATTERN = /^[A-Za-z_]\w*$/;
const ENUM_MEMBER_RESERVED_WORDS = new Set([
  'datasource',
  'default',
  'enum',
  'generator',
  'model',
  'type',
  'types',
]);

export function escapePslString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

export function serializePrintDocument(doc: PrintDocument): string {
  const sections: string[] = [];

  sections.push(doc.headerComment);

  const namedTypeEntries = [...doc.namedTypes].sort((a, b) => a.name.localeCompare(b.name));
  if (namedTypeEntries.length > 0) {
    sections.push(serializeTypesBlock(namedTypeEntries));
  }

  const enumsSorted = [...doc.enums].sort((a, b) => a.name.localeCompare(b.name));
  for (const e of enumsSorted) {
    sections.push(serializeEnum(e));
  }

  for (const model of doc.models) {
    sections.push(serializeModel(model));
  }

  return `${sections.join('\n\n')}\n`;
}

function serializeTypesBlock(namedTypes: readonly PrinterNamedType[]): string {
  const lines = ['types {'];
  for (const nt of namedTypes) {
    const attrStr = nt.attributes.length > 0 ? ` ${nt.attributes.join(' ')}` : '';
    lines.push(`  ${nt.name} = ${nt.baseType}${attrStr}`);
  }
  lines.push('}');
  return lines.join('\n');
}

function serializeEnum(e: {
  name: string;
  mapName?: string | undefined;
  values: readonly string[];
}): string {
  const lines = [`enum ${e.name} {`];
  const usedNames = new Set<string>();
  for (const value of e.values) {
    const memberName = normalizeEnumMemberName(value, usedNames);
    lines.push(`  ${memberName}`);
    usedNames.add(memberName);
  }
  if (e.mapName) {
    lines.push('');
    lines.push(`  @@map("${escapePslString(e.mapName)}")`);
  }
  lines.push('}');
  return lines.join('\n');
}

function serializeModel(model: import('./types').PrinterModel): string {
  const lines: string[] = [];

  if (model.comment) {
    lines.push(model.comment);
  }
  lines.push(`model ${model.name} {`);

  const idFields = model.fields.filter((f) => f.isId);
  const scalarFields = model.fields.filter((f) => !f.isId && !f.isRelation);
  const relationFields = model.fields.filter((f) => f.isRelation);

  const allOrderedFields = [...idFields, ...scalarFields, ...relationFields];

  if (allOrderedFields.length > 0) {
    const maxNameLen = Math.max(...allOrderedFields.map((f) => f.name.length));
    const maxTypeLen = Math.max(...allOrderedFields.map((f) => formatFieldType(f).length));

    for (const field of allOrderedFields) {
      const typePart = formatFieldType(field);
      const paddedName = field.name.padEnd(maxNameLen);
      const paddedType = typePart.padEnd(maxTypeLen);

      if (field.comment) {
        lines.push(`  ${field.comment}`);
      }

      const attrStr = field.attributes.length > 0 ? ` ${field.attributes.join(' ')}` : '';
      lines.push(`  ${paddedName} ${paddedType}${attrStr}`.trimEnd());
    }
  }

  if (model.modelAttributes.length > 0) {
    if (allOrderedFields.length > 0) {
      lines.push('');
    }
    for (const attr of model.modelAttributes) {
      lines.push(`  ${attr}`);
    }
  }

  lines.push('}');
  return lines.join('\n');
}

function formatFieldType(field: PrinterField): string {
  let type = field.typeName;
  if (field.list) {
    type += '[]';
  } else if (field.optional) {
    type += '?';
  }
  return type;
}

function createUniqueFieldName(desiredName: string, usedFieldNames: ReadonlySet<string>): string {
  if (!usedFieldNames.has(desiredName)) {
    return desiredName;
  }

  let counter = 2;
  while (usedFieldNames.has(`${desiredName}${counter}`)) {
    counter++;
  }
  return `${desiredName}${counter}`;
}

function isNormalizedEnumMemberReservedWord(value: string): boolean {
  return ENUM_MEMBER_RESERVED_WORDS.has(value.toLowerCase());
}

function normalizeEnumMemberName(value: string, usedNames: ReadonlySet<string>): string {
  const desiredName =
    PSL_IDENTIFIER_PATTERN.test(value) && !isNormalizedEnumMemberReservedWord(value)
      ? value
      : createNormalizedEnumMemberBaseName(value);

  return createUniqueFieldName(desiredName, usedNames);
}

function createNormalizedEnumMemberBaseName(value: string): string {
  const tokens = value.match(/[A-Za-z0-9]+/g)?.map((token) => token.toLowerCase()) ?? [];
  let normalized = tokens[0] ?? 'value';

  for (const token of tokens.slice(1)) {
    normalized += token.charAt(0).toUpperCase() + token.slice(1);
  }

  if (isNormalizedEnumMemberReservedWord(normalized) || /^\d/.test(normalized)) {
    normalized = `_${normalized}`;
  }

  return normalized;
}
