import type {
  PslAttribute,
  PslAttributeArgument,
  PslDocumentAst,
  PslEnum,
  PslField,
  PslFieldAttribute,
  PslModel,
  PslModelAttribute,
  PslNamedTypeDeclaration,
  PslSpan,
  PslTypesBlock,
} from '@prisma-next/psl-types';
import type { SqlColumnIR, SqlSchemaIR, SqlTableIR } from '@prisma-next/sql-schema-ir/types';
import type { DefaultMappingOptions } from './default-mapping';
import { mapDefault } from './default-mapping';
import { toEnumName, toFieldName, toModelName, toNamedTypeName } from './name-transforms';
import { createPostgresDefaultMapping } from './postgres-default-mapping';
import { createPostgresTypeMap, extractEnumInfo } from './postgres-type-map';
import type {
  EnumInfo,
  PslNativeTypeAttribute,
  PslPrinterOptions,
  PslTypeMap,
  RelationField,
} from './printer-config';
import { parseRawDefault } from './raw-default-parser';
import { inferRelations } from './relation-inference';

const SYNTHETIC_SPAN: PslSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

const PSL_SCALAR_TYPE_NAMES = new Set([
  'String',
  'Boolean',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'DateTime',
  'Json',
  'Bytes',
]);

type ResolvedColumnFieldName = {
  readonly fieldName: string;
  readonly fieldMap?: string | undefined;
};

type TableColumnFieldNameMap = ReadonlyMap<string, ResolvedColumnFieldName>;

type NamedTypeRegistryEntry = {
  readonly name: string;
  readonly baseType: string;
  readonly nativeTypeAttribute: PslNativeTypeAttribute;
};

type NamedTypeRegistry = {
  readonly entriesByKey: Map<string, NamedTypeRegistryEntry>;
  readonly usedNames: Set<string>;
};

type TopLevelNameResult = {
  readonly name: string;
  readonly map?: string | undefined;
};

/**
 * Converts a SQL schema IR into a PSL AST suitable for `printPsl`.
 *
 * This function owns all SQL-specific concerns: native type mapping (Postgres),
 * relation inference from foreign keys, enum extraction, and raw default parsing.
 * The output is a fully-formed `PslDocumentAst` with synthetic spans.
 */
export function sqlSchemaIrToPslAst(schemaIR: SqlSchemaIR): PslDocumentAst {
  const enumInfo = extractEnumInfo(schemaIR.annotations);
  const options: PslPrinterOptions = {
    typeMap: createPostgresTypeMap(enumInfo.typeNames),
    defaultMapping: createPostgresDefaultMapping(),
    enumInfo,
    parseRawDefault,
  };

  return buildPslDocumentAst(schemaIR, options);
}

function buildPslDocumentAst(schemaIR: SqlSchemaIR, options: PslPrinterOptions): PslDocumentAst {
  const { typeMap, defaultMapping, enumInfo, parseRawDefault: rawDefaultParser } = options;
  const emptyEnumInfo: EnumInfo = {
    typeNames: new Set<string>(),
    definitions: new Map<string, readonly string[]>(),
  };
  const { typeNames: enumTypeNames, definitions: enumDefinitions } = enumInfo ?? emptyEnumInfo;

  const modelNames = buildTopLevelNameMap(
    Object.keys(schemaIR.tables),
    toModelName,
    'model',
    'table',
  );
  const enumNames = buildTopLevelNameMap(enumTypeNames, toEnumName, 'enum', 'enum type');
  assertNoCrossKindNameCollisions(modelNames, enumNames);

  const modelNameMap = new Map(
    [...modelNames].map(([tableName, result]) => [tableName, result.name]),
  );
  const enumNameMap = new Map(
    [...enumNames].map(([pgTypeName, result]) => [pgTypeName, result.name]),
  );
  const reservedNamedTypeNames = createReservedNamedTypeNames(modelNames, enumNames);

  const fieldNamesByTable = buildFieldNamesByTable(schemaIR.tables);
  const { relationsByTable } = inferRelations(schemaIR.tables, modelNameMap);
  const namedTypes = seedNamedTypeRegistry(schemaIR, typeMap, enumNameMap, reservedNamedTypeNames);

  const models: PslModel[] = [];
  for (const table of Object.values(schemaIR.tables)) {
    models.push(
      buildModel(
        table,
        typeMap,
        enumNameMap,
        fieldNamesByTable,
        namedTypes,
        defaultMapping,
        rawDefaultParser,
        relationsByTable.get(table.name) ?? [],
      ),
    );
  }

  const sortedModels = topologicalSort(models, schemaIR.tables, modelNameMap);

  const enums: PslEnum[] = [];
  for (const [pgTypeName, values] of enumDefinitions) {
    const enumName = enumNames.get(pgTypeName) as TopLevelNameResult;
    enums.push(buildEnum(enumName, values));
  }
  enums.sort((a, b) => a.name.localeCompare(b.name));

  const namedTypeEntries = [...namedTypes.entriesByKey.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const types: PslTypesBlock | undefined =
    namedTypeEntries.length > 0
      ? {
          kind: 'types',
          declarations: namedTypeEntries.map(buildNamedTypeDeclaration),
          span: SYNTHETIC_SPAN,
        }
      : undefined;

  const ast: PslDocumentAst = {
    kind: 'document',
    sourceId: '<sql-schema-ir>',
    models: sortedModels,
    enums,
    compositeTypes: [],
    ...(types ? { types } : {}),
    span: SYNTHETIC_SPAN,
  };

  return ast;
}

function buildModel(
  table: SqlTableIR,
  typeMap: PslTypeMap,
  enumNameMap: ReadonlyMap<string, string>,
  fieldNamesByTable: ReadonlyMap<string, TableColumnFieldNameMap>,
  namedTypes: NamedTypeRegistry,
  defaultMapping: DefaultMappingOptions | undefined,
  rawDefaultParser: PslPrinterOptions['parseRawDefault'],
  relationFields: readonly RelationField[],
): PslModel {
  const { name: modelName, map: mapName } = toModelName(table.name);
  const fieldNameMap = fieldNamesByTable.get(table.name);

  const pkColumns = new Set(table.primaryKey?.columns ?? []);
  const isSinglePk = pkColumns.size === 1;
  const singlePkConstraintName = isSinglePk ? table.primaryKey?.name : undefined;

  const uniqueColumns = new Map<string, string | undefined>();
  for (const unique of table.uniques) {
    if (unique.columns.length === 1) {
      const [columnName = ''] = unique.columns;
      const existingConstraintName = uniqueColumns.get(columnName);
      if (!uniqueColumns.has(columnName) || (existingConstraintName === undefined && unique.name)) {
        uniqueColumns.set(columnName, unique.name);
      }
    }
  }

  const fields: PslField[] = [];
  for (const column of Object.values(table.columns)) {
    fields.push(
      buildScalarField(
        column,
        table,
        typeMap,
        enumNameMap,
        fieldNameMap,
        namedTypes,
        defaultMapping,
        rawDefaultParser,
        pkColumns,
        isSinglePk,
        singlePkConstraintName,
        uniqueColumns,
      ),
    );
  }

  const usedFieldNames = new Set(fields.map((field) => field.name));
  for (const rel of relationFields) {
    fields.push(buildRelationField(rel, table.name, fieldNamesByTable, usedFieldNames));
  }

  const modelAttributes: PslModelAttribute[] = [];

  if (table.primaryKey && table.primaryKey.columns.length > 1) {
    const pkFieldNames = table.primaryKey.columns.map((columnName) =>
      resolveColumnFieldName(fieldNamesByTable, table.name, columnName),
    );
    modelAttributes.push(buildModelConstraintAttribute('id', pkFieldNames, table.primaryKey.name));
  }

  for (const unique of table.uniques) {
    if (unique.columns.length > 1) {
      const uniqueFieldNames = unique.columns.map((columnName) =>
        resolveColumnFieldName(fieldNamesByTable, table.name, columnName),
      );
      modelAttributes.push(buildModelConstraintAttribute('unique', uniqueFieldNames, unique.name));
    }
  }

  for (const index of table.indexes) {
    if (!index.unique) {
      const indexFieldNames = index.columns.map((columnName) =>
        resolveColumnFieldName(fieldNamesByTable, table.name, columnName),
      );
      modelAttributes.push(buildModelConstraintAttribute('index', indexFieldNames, index.name));
    }
  }

  if (mapName) {
    modelAttributes.push(buildMapAttribute('model', mapName));
  }

  // Surface introspection advisory: tables without a primary key cannot serve
  // as the right-hand side of a `findUnique`-style query downstream, so the
  // user should add an `@id` policy. This warning has shipped since
  // `contract infer` was introduced and is part of the spec § A9 byte-identity
  // contract for SQL output.
  const comment = table.primaryKey
    ? undefined
    : '// WARNING: This table has no primary key in the database';

  return {
    kind: 'model',
    name: modelName,
    fields,
    attributes: modelAttributes,
    span: SYNTHETIC_SPAN,
    ...(comment !== undefined ? { comment } : {}),
  };
}

function buildScalarField(
  column: SqlColumnIR,
  table: SqlTableIR,
  typeMap: PslTypeMap,
  enumNameMap: ReadonlyMap<string, string>,
  fieldNameMap: TableColumnFieldNameMap | undefined,
  namedTypes: NamedTypeRegistry,
  defaultMapping: DefaultMappingOptions | undefined,
  rawDefaultParser: PslPrinterOptions['parseRawDefault'],
  pkColumns: ReadonlySet<string>,
  isSinglePk: boolean,
  singlePkConstraintName: string | undefined,
  uniqueColumns: ReadonlyMap<string, string | undefined>,
): PslField {
  const resolvedField = fieldNameMap?.get(column.name);
  const fieldName = resolvedField?.fieldName ?? toFieldName(column.name).name;
  const fieldMap = resolvedField?.fieldMap;

  const resolution = typeMap.resolve(column.nativeType, table.annotations);

  if ('unsupported' in resolution) {
    const attrs: PslFieldAttribute[] = [];
    if (fieldMap !== undefined) {
      attrs.push(buildMapAttribute('field', fieldMap));
    }
    return {
      kind: 'field',
      name: fieldName,
      typeName: `Unsupported("${escapePslString(resolution.nativeType)}")`,
      optional: column.nullable,
      list: false,
      attributes: attrs,
      span: SYNTHETIC_SPAN,
    };
  }

  let typeName = resolution.pslType;
  const enumPslName = enumNameMap.get(column.nativeType);
  if (enumPslName) {
    typeName = enumPslName;
  }
  if (resolution.nativeTypeAttribute && !enumPslName) {
    typeName = resolveNamedTypeName(namedTypes, resolution);
  }

  const attributes: PslFieldAttribute[] = [];
  const isId = isSinglePk && pkColumns.has(column.name);
  if (isId) {
    attributes.push(buildSimpleConstraintFieldAttribute('id', singlePkConstraintName));
  }

  if (column.default !== undefined) {
    const parsed = parseColumnDefault(column.default, column.nativeType, rawDefaultParser);
    if (parsed) {
      const result = mapDefault(parsed, defaultMapping);
      if ('attribute' in result) {
        attributes.push(parseDefaultAttributeString(result.attribute));
      }
      // 'comment' fallback (unrecognized raw default) is dropped — the
      // M1 legacy path emitted a `// Raw default: ...` line above the field via
      // `PrinterField.comment`. M2 drops this since it would require comment
      // nodes in the AST.
    }
  }

  if (uniqueColumns.has(column.name) && !isId) {
    const uniqueConstraintName = uniqueColumns.get(column.name);
    attributes.push(buildSimpleConstraintFieldAttribute('unique', uniqueConstraintName));
  }

  if (fieldMap !== undefined) {
    attributes.push(buildMapAttribute('field', fieldMap));
  }

  return {
    kind: 'field',
    name: fieldName,
    typeName,
    optional: column.nullable,
    list: false,
    attributes,
    span: SYNTHETIC_SPAN,
  };
}

function buildRelationField(
  rel: RelationField,
  hostTableName: string,
  fieldNamesByTable: ReadonlyMap<string, TableColumnFieldNameMap>,
  usedFieldNames: Set<string>,
): PslField {
  const fieldName = createUniqueFieldName(rel.fieldName, usedFieldNames);
  usedFieldNames.add(fieldName);

  const args: PslAttributeArgument[] = [];

  if (rel.fields && rel.references) {
    if (rel.relationName) {
      args.push(namedArg('name', `"${escapePslString(rel.relationName)}"`));
    }
    args.push(
      namedArg(
        'fields',
        `[${rel.fields
          .map((columnName) => resolveColumnFieldName(fieldNamesByTable, hostTableName, columnName))
          .join(', ')}]`,
      ),
    );
    args.push(
      namedArg(
        'references',
        `[${rel.references
          .map((columnName) =>
            resolveColumnFieldName(fieldNamesByTable, rel.referencedTableName ?? '', columnName),
          )
          .join(', ')}]`,
      ),
    );
    if (rel.onDelete) {
      args.push(namedArg('onDelete', rel.onDelete));
    }
    if (rel.onUpdate) {
      args.push(namedArg('onUpdate', rel.onUpdate));
    }
    if (rel.fkName) {
      args.push(namedArg('map', `"${escapePslString(rel.fkName)}"`));
    }
  } else if (rel.relationName) {
    args.push(namedArg('name', `"${escapePslString(rel.relationName)}"`));
  }

  const attrs: PslFieldAttribute[] =
    args.length > 0 ? [buildAttribute('field', 'relation', args)] : [];

  return {
    kind: 'field',
    name: fieldName,
    typeName: rel.typeName,
    optional: rel.optional,
    list: rel.list,
    attributes: attrs,
    span: SYNTHETIC_SPAN,
  };
}

function buildModelConstraintAttribute(
  name: 'id' | 'unique' | 'index',
  fields: readonly string[],
  constraintName?: string,
): PslModelAttribute {
  const args: PslAttributeArgument[] = [positionalArg(`[${fields.join(', ')}]`)];
  if (constraintName !== undefined) {
    args.push(namedArg('map', `"${escapePslString(constraintName)}"`));
  }
  return buildAttribute('model', name, args);
}

function buildSimpleConstraintFieldAttribute(
  name: 'id' | 'unique',
  constraintName: string | undefined,
): PslFieldAttribute {
  if (constraintName === undefined) {
    return buildAttribute('field', name, []);
  }
  return buildAttribute('field', name, [namedArg('map', `"${escapePslString(constraintName)}"`)]);
}

function parseDefaultAttributeString(attributeText: string): PslFieldAttribute {
  // Strip leading "@default(" and trailing ")" — `mapDefault` always returns one
  // top-level positional expression.
  const inner = attributeText.replace(/^@default\(/, '').replace(/\)$/, '');
  return buildAttribute('field', 'default', [positionalArg(inner)]);
}

function buildMapAttribute(target: 'model' | 'field' | 'enum', mapName: string): PslAttribute {
  return buildAttribute(target, 'map', [positionalArg(`"${escapePslString(mapName)}"`)]);
}

function buildAttribute(
  target: PslAttribute['target'],
  name: string,
  args: readonly PslAttributeArgument[],
): PslAttribute {
  return {
    kind: 'attribute',
    target,
    name,
    args,
    span: SYNTHETIC_SPAN,
  };
}

function positionalArg(value: string): PslAttributeArgument {
  return { kind: 'positional', value, span: SYNTHETIC_SPAN };
}

function namedArg(name: string, value: string): PslAttributeArgument {
  return { kind: 'named', name, value, span: SYNTHETIC_SPAN };
}

function buildEnum(name: TopLevelNameResult, values: readonly string[]): PslEnum {
  const attrs: PslAttribute[] = [];
  if (name.map) {
    attrs.push(buildMapAttribute('enum', name.map));
  }
  return {
    kind: 'enum',
    name: name.name,
    values: values.map((value) => ({
      kind: 'enumValue',
      name: value,
      span: SYNTHETIC_SPAN,
    })),
    attributes: attrs,
    span: SYNTHETIC_SPAN,
  };
}

function buildNamedTypeDeclaration(entry: NamedTypeRegistryEntry): PslNamedTypeDeclaration {
  const attribute = buildAttribute(
    'namedType',
    entry.nativeTypeAttribute.name,
    (entry.nativeTypeAttribute.args ?? []).map(positionalArg),
  );
  return {
    kind: 'namedType',
    name: entry.name,
    baseType: entry.baseType,
    attributes: [attribute],
    span: SYNTHETIC_SPAN,
  };
}

function escapePslString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Resolves a `SqlColumnIR.default` value into a normalized {@link ColumnDefault}.
 *
 * `SqlSchemaIR` types the column default as `string` (a raw database default
 * expression). Some legacy fixtures and tests still pass already-normalized
 * `ColumnDefault` objects in the same slot, so we accept either shape
 * defensively at runtime.
 */
function parseColumnDefault(
  value: unknown,
  nativeType: string | undefined,
  rawDefaultParser: PslPrinterOptions['parseRawDefault'],
): import('@prisma-next/contract/types').ColumnDefault | undefined {
  if (typeof value === 'string') {
    return rawDefaultParser ? rawDefaultParser(value, nativeType) : undefined;
  }
  if (value !== null && typeof value === 'object' && 'kind' in (value as Record<string, unknown>)) {
    return value as import('@prisma-next/contract/types').ColumnDefault;
  }
  return undefined;
}

function buildFieldNamesByTable(
  tables: Record<string, SqlTableIR>,
): ReadonlyMap<string, TableColumnFieldNameMap> {
  const fieldNamesByTable = new Map<string, TableColumnFieldNameMap>();

  for (const table of Object.values(tables)) {
    const columns = Object.values(table.columns).map((column, index) => {
      const { name, map } = toFieldName(column.name);
      return {
        columnName: column.name,
        desiredFieldName: name,
        fieldMap: map,
        index,
      };
    });

    const assignmentOrder = [...columns].sort((left, right) => {
      const mapComparison =
        Number(left.fieldMap !== undefined) - Number(right.fieldMap !== undefined);
      if (mapComparison !== 0) {
        return mapComparison;
      }
      return left.index - right.index;
    });

    const usedFieldNames = new Set<string>();
    const tableFieldNames = new Map<string, ResolvedColumnFieldName>();

    for (const column of assignmentOrder) {
      const fieldName = createUniqueFieldName(column.desiredFieldName, usedFieldNames);
      usedFieldNames.add(fieldName);
      tableFieldNames.set(column.columnName, {
        fieldName,
        fieldMap: column.fieldMap,
      });
    }

    fieldNamesByTable.set(table.name, tableFieldNames);
  }

  return fieldNamesByTable;
}

function resolveColumnFieldName(
  fieldNamesByTable: ReadonlyMap<string, TableColumnFieldNameMap>,
  tableName: string,
  columnName: string,
): string {
  return (
    fieldNamesByTable.get(tableName)?.get(columnName)?.fieldName ?? toFieldName(columnName).name
  );
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

function buildTopLevelNameMap(
  sources: Iterable<string>,
  normalize: (source: string) => TopLevelNameResult,
  kind: 'model' | 'enum',
  sourceKind: 'table' | 'enum type',
): Map<string, TopLevelNameResult> {
  const results = new Map<string, TopLevelNameResult>();
  const normalizedToSources = new Map<string, string[]>();

  for (const source of sources) {
    const normalized = normalize(source);
    results.set(source, normalized);
    normalizedToSources.set(normalized.name, [
      ...(normalizedToSources.get(normalized.name) ?? []),
      source,
    ]);
  }

  const duplicates = [...normalizedToSources.entries()].filter(
    ([, conflictingSources]) => conflictingSources.length > 1,
  );
  if (duplicates.length > 0) {
    const details = duplicates.map(
      ([normalizedName, conflictingSources]) =>
        `- ${kind} "${normalizedName}" from ${sourceKind}s ${conflictingSources
          .map((source) => `"${source}"`)
          .join(', ')}`,
    );
    throw new Error(`PSL ${kind} name collisions detected:\n${details.join('\n')}`);
  }

  return results;
}

function assertNoCrossKindNameCollisions(
  modelNames: ReadonlyMap<string, TopLevelNameResult>,
  enumNames: ReadonlyMap<string, TopLevelNameResult>,
): void {
  const enumSourceByName = new Map([...enumNames].map(([source, result]) => [result.name, source]));

  const collisions = [...modelNames.entries()]
    .map(([tableName, result]) => {
      const enumSource = enumSourceByName.get(result.name);
      return enumSource
        ? `- identifier "${result.name}" from table "${tableName}" collides with enum type "${enumSource}"`
        : undefined;
    })
    .filter((detail): detail is string => detail !== undefined);

  if (collisions.length > 0) {
    throw new Error(`PSL top-level name collisions detected:\n${collisions.join('\n')}`);
  }
}

function createReservedNamedTypeNames(
  modelNames: ReadonlyMap<string, TopLevelNameResult>,
  enumNames: ReadonlyMap<string, TopLevelNameResult>,
): Set<string> {
  const reservedNames = new Set<string>(PSL_SCALAR_TYPE_NAMES);

  for (const result of modelNames.values()) {
    reservedNames.add(result.name);
  }

  for (const result of enumNames.values()) {
    reservedNames.add(result.name);
  }

  return reservedNames;
}

function seedNamedTypeRegistry(
  schemaIR: SqlSchemaIR,
  typeMap: PslTypeMap,
  enumNameMap: ReadonlyMap<string, string>,
  reservedNames: ReadonlySet<string>,
): NamedTypeRegistry {
  type Seed = {
    readonly baseType: string;
    readonly desiredName: string;
    readonly nativeTypeAttribute: PslNativeTypeAttribute;
  };

  const seeds = new Map<string, Seed>();

  for (const tableName of Object.keys(schemaIR.tables).sort()) {
    const table = schemaIR.tables[tableName];
    if (!table) {
      continue;
    }

    for (const columnName of Object.keys(table.columns).sort()) {
      const column = table.columns[columnName];
      if (!column) {
        continue;
      }

      const resolution = typeMap.resolve(column.nativeType, table.annotations);
      if (
        'unsupported' in resolution ||
        enumNameMap.has(column.nativeType) ||
        !resolution.nativeTypeAttribute
      ) {
        continue;
      }

      const signatureKey = createNamedTypeSignatureKey(resolution);
      if (!seeds.has(signatureKey)) {
        seeds.set(signatureKey, {
          baseType: resolution.pslType,
          desiredName: toNamedTypeName(column.name),
          nativeTypeAttribute: resolution.nativeTypeAttribute,
        });
      }
    }
  }

  const registry: NamedTypeRegistry = {
    entriesByKey: new Map<string, NamedTypeRegistryEntry>(),
    usedNames: new Set<string>(reservedNames),
  };

  const sortedSeeds = [...seeds.entries()].sort((left, right) => {
    const desiredNameComparison = left[1].desiredName.localeCompare(right[1].desiredName);
    if (desiredNameComparison !== 0) {
      return desiredNameComparison;
    }
    return left[0].localeCompare(right[0]);
  });

  for (const [signatureKey, seed] of sortedSeeds) {
    const name = createUniqueFieldName(seed.desiredName, registry.usedNames);
    registry.entriesByKey.set(signatureKey, {
      name,
      baseType: seed.baseType,
      nativeTypeAttribute: seed.nativeTypeAttribute,
    });
    registry.usedNames.add(name);
  }

  return registry;
}

function resolveNamedTypeName(
  registry: NamedTypeRegistry,
  resolution: {
    readonly pslType: string;
    readonly nativeType: string;
    readonly typeParams?: Record<string, unknown>;
    readonly nativeTypeAttribute?: PslNativeTypeAttribute;
  },
): string {
  const key = createNamedTypeSignatureKey(resolution);
  const existing = registry.entriesByKey.get(key);
  if (existing) {
    return existing.name;
  }

  throw new Error(`Named type registry was not seeded for native type "${resolution.nativeType}"`);
}

function createNamedTypeSignatureKey(resolution: {
  readonly pslType: string;
  readonly nativeType: string;
  readonly typeParams?: Record<string, unknown>;
  readonly nativeTypeAttribute?: PslNativeTypeAttribute;
}): string {
  return JSON.stringify({
    baseType: resolution.pslType,
    nativeTypeAttribute: resolution.nativeTypeAttribute
      ? {
          name: resolution.nativeTypeAttribute.name,
          args: resolution.nativeTypeAttribute.args ?? null,
        }
      : null,
  });
}

function topologicalSort(
  models: PslModel[],
  tables: Record<string, SqlTableIR>,
  modelNameMap: ReadonlyMap<string, string>,
): PslModel[] {
  const modelByName = new Map<string, PslModel>();
  for (const model of models) {
    modelByName.set(model.name, model);
  }

  const deps = new Map<string, Set<string>>();
  const tableToModel = new Map<string, string>();
  for (const tableName of Object.keys(tables)) {
    const modelName = modelNameMap.get(tableName) as string;
    tableToModel.set(tableName, modelName);
    deps.set(modelName, new Set());
  }

  for (const [tableName, table] of Object.entries(tables)) {
    const modelName = tableToModel.get(tableName) as string;
    for (const fk of table.foreignKeys) {
      const refModelName = tableToModel.get(fk.referencedTable);
      if (refModelName && refModelName !== modelName) {
        (deps.get(modelName) as Set<string>).add(refModelName);
      }
    }
  }

  const result: PslModel[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const sortedNames = [...deps.keys()].sort();

  function visit(name: string): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) return;
    visiting.add(name);

    const sortedDeps = [...(deps.get(name) as Set<string>)].sort();
    for (const dep of sortedDeps) {
      visit(dep);
    }

    visiting.delete(name);
    visited.add(name);
    result.push(modelByName.get(name) as PslModel);
  }

  for (const name of sortedNames) {
    visit(name);
  }

  return result;
}
