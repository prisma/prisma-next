import type {
  AuthoringPslPrinterDescriptor,
  AuthoringPslPrinterNamespace,
} from '@prisma-next/framework-components/authoring';
import { isAuthoringPslPrinterDescriptor } from '@prisma-next/framework-components/authoring';
import type {
  PslPackBlock,
  PslPackBlockPrinterContext,
} from '@prisma-next/framework-components/psl-ast';
import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@prisma-next/framework-components/psl-ast';
import { blindCast } from '@prisma-next/utils/casts';
import type { PrintDocument, PrintNamespaceSection } from './print-document';
import type { PrinterEnumValue, PrinterField, PrinterNamedType } from './types';

/**
 * Indent unit used for PSL block bodies and namespace nesting.
 */
const PSL_INDENT_UNIT = '  ';

/**
 * Discriminator-keyed map from a registered `pslPrinters` namespace to the
 * descriptor that handles each AST node `kind`. Built once per
 * `serializePrintDocument` call so the per-block dispatch in
 * `serializeNamespaceContents` is constant-time.
 */
type PslPrinterDispatchMap = ReadonlyMap<string, AuthoringPslPrinterDescriptor>;

function buildPslPrinterDispatchMap(
  namespace: AuthoringPslPrinterNamespace | undefined,
): PslPrinterDispatchMap {
  const entries = new Map<string, AuthoringPslPrinterDescriptor>();
  if (!namespace) {
    return entries;
  }
  collectPrinterDescriptors(namespace, entries);
  return entries;
}

function collectPrinterDescriptors(
  namespace: AuthoringPslPrinterNamespace,
  out: Map<string, AuthoringPslPrinterDescriptor>,
): void {
  for (const value of Object.values(namespace)) {
    if (isAuthoringPslPrinterDescriptor(value)) {
      out.set(value.discriminator, value);
      continue;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      collectPrinterDescriptors(
        blindCast<
          AuthoringPslPrinterNamespace,
          'recursive descent into a sub-namespace whose leaves are still walked by isAuthoringPslPrinterDescriptor'
        >(value),
        out,
      );
    }
  }
}

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

export interface SerializePrintDocumentOptions {
  readonly pslPrinters?: AuthoringPslPrinterNamespace;
}

export function serializePrintDocument(
  doc: PrintDocument,
  options: SerializePrintDocumentOptions = {},
): string {
  const sections: string[] = [];

  sections.push(doc.headerComment);

  const namedTypeEntries = [...doc.namedTypes].sort((a, b) => a.name.localeCompare(b.name));
  if (namedTypeEntries.length > 0) {
    sections.push(serializeTypesBlock(namedTypeEntries));
  }

  const printerDispatchMap = buildPslPrinterDispatchMap(options.pslPrinters);
  const printerContext: PslPackBlockPrinterContext = {
    indent: PSL_INDENT_UNIT,
    escapeStringLiteral: escapePslString,
  };

  for (const namespace of doc.namespaces) {
    const namespaceSections = serializeNamespaceContents(
      namespace,
      printerDispatchMap,
      printerContext,
    );
    if (namespaceSections.length === 0) {
      continue;
    }
    if (namespace.name === UNSPECIFIED_PSL_NAMESPACE_ID) {
      // The parser-synthesised bucket exists for AST symmetry; printing it as
      // `namespace __unspecified__ { … }` would invent syntax the user never
      // wrote. Top-level declarations round-trip back to top-level output.
      sections.push(...namespaceSections);
    } else {
      sections.push(wrapNamespaceBlock(namespace.name, namespaceSections));
    }
  }

  return `${sections.join('\n\n')}\n`;
}

function serializeNamespaceContents(
  namespace: PrintNamespaceSection,
  printerDispatchMap: PslPrinterDispatchMap,
  printerContext: PslPackBlockPrinterContext,
): string[] {
  const sections: string[] = [];
  const enumsSorted = [...namespace.enums].sort((a, b) => a.name.localeCompare(b.name));
  for (const e of enumsSorted) {
    sections.push(serializeEnum(e));
  }
  for (const model of namespace.models) {
    sections.push(serializeModel(model));
  }
  for (const packBlock of namespace.packBlocks) {
    sections.push(serializePackBlock(packBlock, printerDispatchMap, printerContext));
  }
  return sections;
}

function serializePackBlock(
  packBlock: PslPackBlock,
  printerDispatchMap: PslPrinterDispatchMap,
  printerContext: PslPackBlockPrinterContext,
): string {
  const descriptor = printerDispatchMap.get(packBlock.kind);
  if (!descriptor) {
    throw new Error(
      `No pslPrinter contribution registered for pack-contributed block discriminator "${packBlock.kind}". Provide a matching pslPrinter contribution to printPsl, or remove the block from the input AST.`,
    );
  }
  // The descriptor's `printer` field is declared with `Input extends
  // PslPackBlock = never` so a pack literal's concrete printer type
  // (`(node: SomeAst, …) => string`) assigns to the base shape across
  // the contravariant function-parameter position. At dispatch time we
  // hold the descriptor as the base shape, so its declared `Input` is
  // `never` — but the runtime function is the pack's specific
  // implementation, which expects the actual AST shape. The
  // discriminator-keyed lookup pairs each `packBlock` with the
  // descriptor whose pack contributed it (triple-bundle validation
  // ensures the pairing exists), so the runtime contract holds even
  // though TypeScript cannot prove the connection at the dispatch site.
  const printerFn = blindCast<
    (input: PslPackBlock, context: PslPackBlockPrinterContext) => string,
    'discriminator-keyed dispatch pairs the descriptor with the AST node its pack produced; runtime contract holds while the static type narrows through `Input = never` for assignability'
  >(descriptor.printer);
  return printerFn(packBlock, printerContext);
}

function wrapNamespaceBlock(name: string, innerSections: readonly string[]): string {
  const indented = innerSections
    .map((section) =>
      section
        .split('\n')
        .map((line) => (line.length > 0 ? `  ${line}` : line))
        .join('\n'),
    )
    .join('\n\n');
  return `namespace ${name} {\n${indented}\n}`;
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
  values: readonly PrinterEnumValue[];
}): string {
  const lines = [`enum ${e.name} {`];
  const usedNames = new Set<string>();
  for (const value of e.values) {
    const memberName = normalizeEnumMemberName(value.name, usedNames);
    // Emit a per-member `@map("...")` whenever the printed identifier differs
    // from the original storage label (e.g. PostgreSQL enum labels with
    // hyphens that get normalised to camelCase, reserved words that get
    // `_`-prefixed, or names that collide and get a numeric suffix), or when
    // the AST carried an explicit `mapName` from a parsed source. Without
    // this, parsing the emitted PSL would lose the original storage label and
    // a subsequent `contract emit` would talk to the wrong DB enum value.
    const explicitMap = value.mapName;
    const storageLabel =
      explicitMap !== undefined ? explicitMap : memberName !== value.name ? value.name : undefined;
    if (storageLabel !== undefined) {
      lines.push(`  ${memberName} @map("${escapePslString(storageLabel)}")`);
    } else {
      lines.push(`  ${memberName}`);
    }
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
