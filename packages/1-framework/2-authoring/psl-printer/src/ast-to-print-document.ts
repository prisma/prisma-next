import type {
  PslAttribute,
  PslAttributeArgument,
  PslDocumentAst,
  PslEnum,
  PslField,
  PslModel,
  PslNamedTypeDeclaration,
  PslTypeConstructorCall,
} from '@prisma-next/framework-components/psl-ast';
import type { PrintDocument } from './print-document';
import { escapePslString } from './serialize-print-document';
import type { PrinterEnum, PrinterField, PrinterModel, PrinterNamedType } from './types';

const DEFAULT_AST_PRINT_HEADER =
  '// This file was introspected from the database. Do not edit manually.';

export function astDocumentToPrintDocument(ast: PslDocumentAst): PrintDocument {
  const modelNames = new Set(ast.models.map((m) => m.name));
  const deps = buildModelFkDeps(ast.models, modelNames);
  const sortedModels = topologicalSortModels(ast.models, deps);

  const namedTypes: PrinterNamedType[] = ast.types
    ? ast.types.declarations.map(namedTypeDeclarationToPrinterNamedType)
    : [];

  const enums: PrinterEnum[] = ast.enums.map(enumToPrinterEnum);

  const printerModels = sortedModels.map((m) => modelToPrinterModel(m));

  return {
    headerComment: DEFAULT_AST_PRINT_HEADER,
    namedTypes,
    enums: enums.map((e) => ({
      name: e.name,
      mapName: e.mapName,
      values: e.values,
    })),
    models: printerModels,
  };
}

export function renderPslAttribute(attr: PslAttribute): string {
  const prefix = attr.target === 'model' || attr.target === 'enum' ? '@@' : '@';
  if (attr.args.length === 0) {
    return `${prefix}${attr.name}`;
  }
  const inner = attr.args.map(renderAttributeArgument).join(', ');
  return `${prefix}${attr.name}(${inner})`;
}

function renderAttributeArgument(arg: PslAttributeArgument): string {
  if (arg.kind === 'positional') {
    return arg.value;
  }
  return `${arg.name}: ${arg.value}`;
}

function namedTypeDeclarationToPrinterNamedType(decl: PslNamedTypeDeclaration): PrinterNamedType {
  const base =
    decl.baseType ??
    (decl.typeConstructor !== undefined ? formatTypeConstructor(decl.typeConstructor) : '');
  const attributes = decl.attributes.map(renderPslAttribute);
  return {
    name: decl.name,
    baseType: base,
    attributes,
  };
}

function formatTypeConstructor(tc: PslTypeConstructorCall): string {
  const path = tc.path.join('.');
  if (tc.args.length === 0) {
    return path;
  }
  return `${path}(${tc.args.map(renderAttributeArgument).join(', ')})`;
}

function enumToPrinterEnum(en: PslEnum): PrinterEnum {
  let mapName: string | undefined;
  for (const a of en.attributes) {
    if (a.name === 'map' && a.target === 'enum') {
      const quoted = getPositionalStringArg(a, 0);
      if (quoted !== undefined) {
        mapName = quoted;
      }
    }
  }
  return {
    name: en.name,
    mapName,
    values: en.values.map((v) => v.name),
  };
}

function getPositionalStringArg(attr: PslAttribute, index: number): string | undefined {
  const positional = attr.args.filter((a) => a.kind === 'positional');
  const raw = positional[index]?.value.trim();
  if (!raw) return undefined;
  const m = raw.match(/^(['"])(.*)\1$/);
  return m?.[2];
}

function modelToPrinterModel(model: PslModel): PrinterModel {
  let mapName: string | undefined;
  const modelAttrStrings: string[] = [];

  for (const a of model.attributes) {
    if (a.name === 'map' && a.target === 'model') {
      mapName = getPositionalStringArg(a, 0) ?? mapName;
      continue;
    }
    modelAttrStrings.push(renderPslAttribute(a));
  }

  if (mapName !== undefined) {
    modelAttrStrings.push(`@@map("${escapePslString(mapName)}")`);
  }

  const printerFields = model.fields.map((f) => fieldToPrinterField(f));

  return {
    name: model.name,
    mapName,
    fields: printerFields,
    modelAttributes: modelAttrStrings,
    comment: model.comment,
  };
}

function fieldToPrinterField(field: PslField): PrinterField {
  const typeName =
    field.typeConstructor !== undefined
      ? formatTypeConstructor(field.typeConstructor)
      : field.typeName;

  let mapName: string | undefined;
  const attrStrings: string[] = [];

  for (const a of field.attributes) {
    if (a.name === 'map' && a.target === 'field') {
      mapName = getPositionalStringArg(a, 0) ?? mapName;
      continue;
    }
    attrStrings.push(renderPslAttribute(a));
  }

  if (mapName !== undefined) {
    attrStrings.push(`@map("${escapePslString(mapName)}")`);
  }

  const isRelation = field.attributes.some((a) => a.name === 'relation' && a.target === 'field');

  const isUnsupported = typeName.startsWith('Unsupported(');

  const isId = field.attributes.some((a) => a.name === 'id' && a.target === 'field');

  return {
    name: field.name,
    typeName,
    optional: field.optional,
    list: field.list,
    attributes: attrStrings,
    mapName,
    isId,
    isRelation,
    isUnsupported,
    comment: undefined,
  };
}

function buildModelFkDeps(
  models: readonly PslModel[],
  modelNames: ReadonlySet<string>,
): Map<string, Set<string>> {
  const deps = new Map<string, Set<string>>();
  for (const m of models) {
    deps.set(m.name, new Set());
  }

  for (const m of models) {
    for (const field of m.fields) {
      const refModel = relationReferencedModel(field, modelNames);
      if (!refModel || refModel === m.name) continue;
      if (!hasFullRelation(field)) continue;
      (deps.get(m.name) as Set<string>).add(refModel);
    }
  }

  return deps;
}

function hasFullRelation(field: PslField): boolean {
  const rel = field.attributes.find((a) => a.name === 'relation' && a.target === 'field');
  if (!rel) return false;
  const named = Object.fromEntries(
    rel.args
      .filter(
        (a): a is import('@prisma-next/framework-components/psl-ast').PslAttributeNamedArgument =>
          a.kind === 'named',
      )
      .map((a) => [a.name, a.value.trim()]),
  );
  return named['fields'] !== undefined && named['references'] !== undefined;
}

function relationReferencedModel(
  field: PslField,
  modelNames: ReadonlySet<string>,
): string | undefined {
  const head = field.typeConstructor?.path[0];
  const raw = head ?? field.typeName.replace(/\?$/, '').replace(/\[\]$/, '');
  if (raw.length === 0) {
    return undefined;
  }
  return modelNames.has(raw) ? raw : undefined;
}

function topologicalSortModels(
  models: readonly PslModel[],
  deps: ReadonlyMap<string, Set<string>>,
): PslModel[] {
  const byName = new Map(models.map((m) => [m.name, m]));
  const result: PslModel[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const sortedNames = [...deps.keys()].sort();

  function visit(name: string): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) return;
    visiting.add(name);

    const sortedDeps = [...(deps.get(name) ?? new Set())].sort();
    for (const dep of sortedDeps) {
      visit(dep);
    }

    visiting.delete(name);
    visited.add(name);
    const model = byName.get(name);
    if (model) {
      result.push(model);
    }
  }

  for (const name of sortedNames) {
    visit(name);
  }

  return result;
}
