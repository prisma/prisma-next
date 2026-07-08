import type {
  AuthoringPslBlockDescriptor,
  AuthoringPslBlockDescriptorNamespace,
} from '@prisma-next/framework-components/authoring';
import { isAuthoringPslBlockDescriptor } from '@prisma-next/framework-components/authoring';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type {
  PslBlockParam,
  PslExtensionBlock,
  PslExtensionBlockParamValue,
} from '@prisma-next/framework-components/psl-ast';
import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@prisma-next/framework-components/psl-ast';
import { blindCast } from '@prisma-next/utils/casts';
import type { PrintDocument, PrintNamespaceSection } from './print-document';
import type { PrinterField, PrinterNamedType } from './types';

/**
 * Indent unit used for PSL block bodies and namespace nesting.
 */
const PSL_INDENT_UNIT = '  ';

type PslBlockDispatchMap = ReadonlyMap<string, AuthoringPslBlockDescriptor>;

function buildPslBlockDispatchMap(
  namespace: AuthoringPslBlockDescriptorNamespace | undefined,
): PslBlockDispatchMap {
  const entries = new Map<string, AuthoringPslBlockDescriptor>();
  if (!namespace) {
    return entries;
  }
  collectBlockDescriptors(namespace, entries);
  return entries;
}

function collectBlockDescriptors(
  namespace: AuthoringPslBlockDescriptorNamespace,
  out: Map<string, AuthoringPslBlockDescriptor>,
): void {
  for (const value of Object.values(namespace)) {
    if (isAuthoringPslBlockDescriptor(value)) {
      out.set(value.discriminator, value);
      continue;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      collectBlockDescriptors(value, out);
    }
  }
}

export function escapePslString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

export interface SerializePrintDocumentOptions {
  readonly pslBlockDescriptors?: AuthoringPslBlockDescriptorNamespace;
  readonly codecLookup?: CodecLookup;
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

  const blockDispatchMap = buildPslBlockDispatchMap(options.pslBlockDescriptors);

  for (const namespace of doc.namespaces) {
    const namespaceSections = serializeNamespaceContents(
      namespace,
      blockDispatchMap,
      options.codecLookup,
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
  blockDispatchMap: PslBlockDispatchMap,
  codecLookup: CodecLookup | undefined,
): string[] {
  const sections: string[] = [];
  for (const model of namespace.models) {
    sections.push(serializeModel(model));
  }
  for (const extensionBlock of namespace.extensionBlocks) {
    sections.push(serializeExtensionBlock(extensionBlock, blockDispatchMap, codecLookup));
  }
  return sections;
}

function serializeExtensionBlock(
  extensionBlock: PslExtensionBlock,
  blockDispatchMap: PslBlockDispatchMap,
  codecLookup: CodecLookup | undefined,
): string {
  const descriptor = blockDispatchMap.get(extensionBlock.kind);
  if (!descriptor) {
    throw new Error(
      `No pslBlockDescriptors contribution registered for extension-contributed block discriminator "${extensionBlock.kind}". Provide a matching pslBlockDescriptors contribution to serializePrintDocument, or remove the block from the input AST.`,
    );
  }
  const lines: string[] = [`${descriptor.keyword} ${extensionBlock.name} {`];
  for (const [paramName, paramDescriptor] of Object.entries(descriptor.parameters)) {
    const paramValue = extensionBlock.parameters[paramName];
    if (paramValue === undefined) {
      continue;
    }
    const rendered = renderParamValue(paramValue, paramDescriptor, codecLookup, paramName);
    lines.push(`${PSL_INDENT_UNIT}${paramName} = ${rendered}`);
  }
  lines.push('}');
  return lines.join('\n');
}

function renderParamValue(
  paramValue: PslExtensionBlockParamValue,
  descriptor: PslBlockParam,
  codecLookup: CodecLookup | undefined,
  paramName: string,
): string {
  switch (descriptor.kind) {
    case 'ref': {
      if (paramValue.kind !== 'ref') {
        throw new Error(
          `Extension block parameter "${paramName}": descriptor is "ref" but AST node has kind "${paramValue.kind}"`,
        );
      }
      return paramValue.identifier;
    }
    case 'value': {
      if (paramValue.kind !== 'value') {
        throw new Error(
          `Extension block parameter "${paramName}": descriptor is "value" but AST node has kind "${paramValue.kind}"`,
        );
      }
      return renderValueParam(paramValue.raw, descriptor.codecId, codecLookup, paramName);
    }
    case 'option': {
      if (paramValue.kind !== 'option') {
        throw new Error(
          `Extension block parameter "${paramName}": descriptor is "option" but AST node has kind "${paramValue.kind}"`,
        );
      }
      return paramValue.token;
    }
    case 'list': {
      if (paramValue.kind !== 'list') {
        throw new Error(
          `Extension block parameter "${paramName}": descriptor is "list" but AST node has kind "${paramValue.kind}"`,
        );
      }
      const items = paramValue.items.map((item) =>
        renderParamValue(item, descriptor.of, codecLookup, paramName),
      );
      return `[${items.join(', ')}]`;
    }
  }
}

function renderValueParam(
  raw: string,
  codecId: string,
  codecLookup: CodecLookup | undefined,
  paramName: string,
): string {
  if (!codecLookup) {
    return raw;
  }
  const codec = codecLookup.get(codecId);
  if (!codec) {
    throw new Error(
      `Extension block parameter "${paramName}": no codec registered for id "${codecId}"`,
    );
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `Extension block parameter "${paramName}": codec "${codecId}" — raw literal is not valid JSON: ${String(e)}`,
    );
  }
  return JSON.stringify(
    codec.encodeJson(
      codec.decodeJson(
        blindCast<Parameters<typeof codec.decodeJson>[0], 'JSON.parse output is JsonValue'>(
          parsedJson,
        ),
      ),
    ),
  );
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
