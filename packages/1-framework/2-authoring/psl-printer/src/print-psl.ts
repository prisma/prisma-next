import type { ColumnDefault } from '@prisma-next/contract/types';
import { mapDefault } from './default-mapping';
import { toEnumName, toFieldName, toModelName, toNamedTypeName } from './name-transforms';
import { extractEnumDefinitions, extractEnumTypeNames } from './postgres-type-map';
import { parseRawDefault } from './raw-default-parser';
import { inferRelations } from './relation-inference';
import type { PslPrintableSqlSchemaIR, PslPrintableSqlTable } from './schema-validation';
import type {
  PrinterField,
  PrinterModel,
  PrinterNamedType,
  PslNativeTypeAttribute,
  PslPrinterOptions,
  RelationField,
} from './types';

const DEFAULT_HEADER = '// This file was introspected from the database. Do not edit manually.';

type ResolvedColumnFieldName = {
  readonly fieldName: string;
  readonly fieldMap?: string | undefined;
};

type TableColumnFieldNameMap = ReadonlyMap<string, ResolvedColumnFieldName>;

type NamedTypeRegistry = {
  readonly entriesByKey: Map<string, PrinterNamedType>;
  readonly usedNames: Set<string>;
};

type TopLevelNameResult = {
  readonly name: string;
  readonly map?: string | undefined;
};

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

/**
 * Converts a SqlSchemaIR to a PSL (Prisma Schema Language) string.
 *
 * The output follows PSL formatting conventions:
 * - Header comment
 * - `types` block (if parameterized types exist)
 * - `enum` blocks (alphabetical)
 * - `model` blocks (topologically sorted by FK deps, alphabetical fallback)
 *
 * @param schemaIR - The introspected schema IR
 * @param options - Printer configuration (type map, header)
 * @returns A valid PSL string
 */
export function printPsl(schemaIR: PslPrintableSqlSchemaIR, options: PslPrinterOptions): string {
  const { typeMap, header, defaultMapping } = options;
  const headerComment = header ?? DEFAULT_HEADER;

  // Extract enum info from annotations
  const enumTypeNames = extractEnumTypeNames(schemaIR.annotations);
  const enumDefinitions = extractEnumDefinitions(schemaIR.annotations);

  // Build model name mapping (db table name → PSL model name)
  const modelNames = buildTopLevelNameMap(
    Object.keys(schemaIR.tables),
    toModelName,
    'model',
    'table',
  );

  // Build enum name mapping (db type name → PSL enum name)
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

  // Infer relations from foreign keys
  const { relationsByTable } = inferRelations(schemaIR.tables, modelNameMap);

  // Collect named types for the types block
  const namedTypes = seedNamedTypeRegistry(schemaIR, typeMap, enumNameMap, reservedNamedTypeNames);

  // Process tables into models
  const models: PrinterModel[] = [];
  for (const table of Object.values(schemaIR.tables)) {
    const model = processTable(
      table,
      typeMap,
      enumNameMap,
      fieldNamesByTable,
      namedTypes,
      defaultMapping,
      relationsByTable.get(table.name) ?? [],
    );
    models.push(model);
  }

  // Process enums
  const enums: Array<{ name: string; mapName: string | undefined; values: readonly string[] }> = [];
  for (const [pgTypeName, values] of enumDefinitions) {
    const enumName = enumNames.get(pgTypeName) as TopLevelNameResult;
    enums.push({ name: enumName.name, mapName: enumName.map, values });
  }

  // Sort enums alphabetically
  enums.sort((a, b) => a.name.localeCompare(b.name));

  // Sort models topologically by FK dependencies
  const sortedModels = topologicalSort(models, schemaIR.tables, modelNameMap);

  // Serialize
  const sections: string[] = [];

  // Header
  sections.push(headerComment);

  // Types block
  const namedTypeEntries = [...namedTypes.entriesByKey.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  if (namedTypeEntries.length > 0) {
    sections.push(serializeTypesBlock(namedTypeEntries));
  }

  // Enum blocks
  for (const e of enums) {
    sections.push(serializeEnum(e));
  }

  // Model blocks
  for (const model of sortedModels) {
    sections.push(serializeModel(model));
  }

  return `${sections.join('\n\n')}\n`;
}

/**
 * Processes a SQL table into a PrinterModel.
 */
function processTable(
  table: PslPrintableSqlTable,
  typeMap: PslPrinterOptions['typeMap'],
  enumNameMap: ReadonlyMap<string, string>,
  fieldNamesByTable: ReadonlyMap<string, TableColumnFieldNameMap>,
  namedTypes: NamedTypeRegistry,
  defaultMapping: PslPrinterOptions['defaultMapping'],
  relationFields: readonly RelationField[],
): PrinterModel {
  const { name: modelName, map: mapName } = toModelName(table.name);
  const fieldNameMap = fieldNamesByTable.get(table.name);

  const pkColumns = new Set(table.primaryKey?.columns ?? []);
  const isSinglePk = pkColumns.size === 1;
  const singlePkConstraintName = isSinglePk ? table.primaryKey?.name : undefined;

  // Build lookup for unique single-column constraints.
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

  // Process columns into fields
  const fields: PrinterField[] = [];
  const columnEntries = Object.values(table.columns);

  for (const column of columnEntries) {
    const resolvedField = fieldNameMap?.get(column.name);
    const fieldName = resolvedField?.fieldName ?? toFieldName(column.name).name;
    const fieldMap = resolvedField?.fieldMap;

    // Resolve type
    const resolution = typeMap.resolve(column.nativeType, table.annotations);

    if ('unsupported' in resolution) {
      // Unsupported type
      fields.push({
        name: fieldName,
        typeName: `Unsupported("${resolution.nativeType}")`,
        optional: column.nullable,
        list: false,
        attributes: fieldMap ? [`@map("${fieldMap}")`] : [],
        mapName: fieldMap ?? undefined,
        isId: false,
        isRelation: false,
        isUnsupported: true,
      });
      continue;
    }

    // Check if this is an enum type
    let typeName = resolution.pslType;
    const enumPslName = enumNameMap.get(column.nativeType);
    if (enumPslName) {
      typeName = enumPslName;
    }

    // Preserve non-default native storage shapes via named types.
    if (resolution.nativeTypeAttribute && !enumPslName) {
      typeName = resolveNamedTypeName(namedTypes, resolution);
    }

    // Build attributes
    const attributes: string[] = [];
    const isId = isSinglePk && pkColumns.has(column.name);
    if (isId) {
      attributes.push(formatFieldConstraintAttribute('@id', singlePkConstraintName));
    }

    // Default value
    let comment: string | undefined;
    if (column.default !== undefined) {
      const parsed = parseDefaultIfNeeded(column.default, column.nativeType);
      if (parsed) {
        const result = mapDefault(parsed, defaultMapping);
        if ('attribute' in result) {
          attributes.push(result.attribute);
        } else {
          comment = result.comment;
        }
      }
    }

    // Unique
    const uniqueConstraintName = uniqueColumns.get(column.name);
    if (uniqueConstraintName !== undefined || uniqueColumns.has(column.name)) {
      if (!isId) {
        attributes.push(formatFieldConstraintAttribute('@unique', uniqueConstraintName));
      }
    }

    // Map
    if (fieldMap) {
      attributes.push(`@map("${fieldMap}")`);
    }

    fields.push({
      name: fieldName,
      typeName,
      optional: column.nullable,
      list: false,
      attributes,
      mapName: fieldMap ?? undefined,
      isId,
      isRelation: false,
      isUnsupported: false,
      comment,
    });
  }

  // Add relation fields
  const usedFieldNames = new Set(fields.map((field) => field.name));
  for (const rel of relationFields) {
    const relationFieldName = createUniqueFieldName(rel.fieldName, usedFieldNames);
    const relAttributes: string[] = [];

    if (rel.fields && rel.references) {
      const parts: string[] = [];
      if (rel.relationName) {
        parts.push(`name: "${rel.relationName}"`);
      }
      parts.push(
        `fields: [${rel.fields
          .map((fieldName) => resolveColumnFieldName(fieldNamesByTable, table.name, fieldName))
          .join(', ')}]`,
      );
      parts.push(
        `references: [${rel.references
          .map((fieldName) =>
            resolveColumnFieldName(fieldNamesByTable, rel.referencedTableName ?? '', fieldName),
          )
          .join(', ')}]`,
      );
      if (rel.onDelete) {
        parts.push(`onDelete: ${rel.onDelete}`);
      }
      if (rel.onUpdate) {
        parts.push(`onUpdate: ${rel.onUpdate}`);
      }
      if (rel.fkName) {
        parts.push(`map: "${rel.fkName}"`);
      }
      relAttributes.push(`@relation(${parts.join(', ')})`);
    } else if (rel.relationName) {
      relAttributes.push(`@relation(name: "${rel.relationName}")`);
    }

    fields.push({
      name: relationFieldName,
      typeName: rel.typeName,
      optional: rel.optional,
      list: rel.list,
      attributes: relAttributes,
      isId: false,
      isRelation: true,
      isUnsupported: false,
    });
    usedFieldNames.add(relationFieldName);
  }

  // Model-level attributes
  const modelAttributes: string[] = [];

  // Composite PK
  if (table.primaryKey && table.primaryKey.columns.length > 1) {
    const pkFieldNames = table.primaryKey.columns.map((columnName) =>
      resolveColumnFieldName(fieldNamesByTable, table.name, columnName),
    );
    modelAttributes.push(
      formatModelConstraintAttribute('@@id', pkFieldNames, table.primaryKey.name),
    );
  }

  // Composite unique constraints
  for (const unique of table.uniques) {
    if (unique.columns.length > 1) {
      const fieldNames = unique.columns.map((columnName) =>
        resolveColumnFieldName(fieldNamesByTable, table.name, columnName),
      );
      modelAttributes.push(formatModelConstraintAttribute('@@unique', fieldNames, unique.name));
    }
  }

  // Indexes (non-unique only; unique indexes are handled by @@unique)
  for (const index of table.indexes) {
    if (!index.unique) {
      const fieldNames = index.columns.map((columnName) =>
        resolveColumnFieldName(fieldNamesByTable, table.name, columnName),
      );
      modelAttributes.push(formatModelConstraintAttribute('@@index', fieldNames, index.name));
    }
  }

  // @@map
  if (mapName) {
    modelAttributes.push(`@@map("${mapName}")`);
  }

  // Table without PK warning
  const tableComment = !table.primaryKey
    ? '// WARNING: This table has no primary key in the database'
    : undefined;

  return {
    name: modelName,
    mapName: mapName ?? undefined,
    fields,
    modelAttributes,
    comment: tableComment,
  };
}

/**
 * Parses a default value into a ColumnDefault.
 * Handles both pre-normalized ColumnDefault objects and raw string expressions.
 */
function isColumnDefault(value: unknown): value is ColumnDefault {
  if (typeof value !== 'object' || value === null || !Object.hasOwn(value, 'kind')) {
    return false;
  }

  const kind = Reflect.get(value, 'kind');
  if (kind === 'literal') {
    return Object.hasOwn(value, 'value');
  }
  if (kind === 'function') {
    return typeof Reflect.get(value, 'expression') === 'string';
  }

  return false;
}

function parseDefaultIfNeeded(value: unknown, nativeType?: string): ColumnDefault | undefined {
  if (isColumnDefault(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return parseRawDefault(value, nativeType);
  }
  return undefined;
}

function formatFieldConstraintAttribute(
  attribute: '@id' | '@unique',
  constraintName?: string,
): string {
  return constraintName ? `${attribute}(map: "${constraintName}")` : attribute;
}

function formatModelConstraintAttribute(
  attribute: '@@id' | '@@unique' | '@@index',
  fields: readonly string[],
  constraintName?: string,
): string {
  const parts = [`[${fields.join(', ')}]`];
  if (constraintName) {
    parts.push(`map: "${constraintName}"`);
  }
  return `${attribute}(${parts.join(', ')})`;
}

function buildFieldNamesByTable(
  tables: Record<string, PslPrintableSqlTable>,
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
  schemaIR: PslPrintableSqlSchemaIR,
  typeMap: PslPrinterOptions['typeMap'],
  enumNameMap: ReadonlyMap<string, string>,
  reservedNames: ReadonlySet<string>,
): NamedTypeRegistry {
  const seeds = new Map<
    string,
    {
      readonly baseType: string;
      readonly desiredName: string;
      readonly attributes: readonly string[];
    }
  >();

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
          attributes: [renderNativeTypeAttribute(resolution.nativeTypeAttribute)],
        });
      }
    }
  }

  const registry: NamedTypeRegistry = {
    entriesByKey: new Map<string, PrinterNamedType>(),
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
      attributes: seed.attributes,
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

/**
 * Topologically sorts models by FK dependencies.
 * Parent tables (those referenced by FKs) come before child tables.
 * Alphabetical fallback for cycles.
 */
function topologicalSort(
  models: PrinterModel[],
  tables: Record<string, PslPrintableSqlTable>,
  modelNameMap: ReadonlyMap<string, string>,
): PrinterModel[] {
  const modelByName = new Map<string, PrinterModel>();
  for (const model of models) {
    modelByName.set(model.name, model);
  }

  // Build adjacency: model name → set of model names it depends on (via FK)
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

  // DFS-based topological sort with cycle detection
  const result: PrinterModel[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  // Sort model names alphabetically for deterministic output
  const sortedNames = [...deps.keys()].sort();

  function visit(name: string): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) return; // Cycle — break it (alphabetical order handles it)
    visiting.add(name);

    // Visit dependencies first (parent tables before child tables)
    const sortedDeps = [...(deps.get(name) as Set<string>)].sort();
    for (const dep of sortedDeps) {
      visit(dep);
    }

    visiting.delete(name);
    visited.add(name);
    result.push(modelByName.get(name) as PrinterModel);
  }

  for (const name of sortedNames) {
    visit(name);
  }

  return result;
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serializes the `types` block.
 */
function serializeTypesBlock(namedTypes: readonly PrinterNamedType[]): string {
  const lines = ['types {'];
  for (const nt of namedTypes) {
    const attrStr = nt.attributes.length > 0 ? ` ${nt.attributes.join(' ')}` : '';
    lines.push(`  ${nt.name} = ${nt.baseType}${attrStr}`);
  }
  lines.push('}');
  return lines.join('\n');
}

function renderNativeTypeAttribute(attribute: PslNativeTypeAttribute): string {
  if (!attribute.args || attribute.args.length === 0) {
    return `@${attribute.name}`;
  }
  return `@${attribute.name}(${attribute.args.join(', ')})`;
}

/**
 * Serializes an enum block.
 */
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
    lines.push(`  @@map("${e.mapName}")`);
  }
  lines.push('}');
  return lines.join('\n');
}

/**
 * Serializes a model block with column-aligned fields.
 */
function serializeModel(model: PrinterModel): string {
  const lines: string[] = [];

  if (model.comment) {
    lines.push(model.comment);
  }
  lines.push(`model ${model.name} {`);

  // Separate fields into groups:
  // 1. @id fields first
  // 2. Scalar fields (non-id, non-relation) in original order
  // 3. Relation fields
  const idFields = model.fields.filter((f) => f.isId);
  const scalarFields = model.fields.filter((f) => !f.isId && !f.isRelation);
  const relationFields = model.fields.filter((f) => f.isRelation);

  const allOrderedFields = [...idFields, ...scalarFields, ...relationFields];

  if (allOrderedFields.length > 0) {
    // Calculate column widths for alignment
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

  // Model-level attributes (blank line before if there are fields)
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

/**
 * Formats a field type string with optional/list modifiers.
 */
function formatFieldType(field: PrinterField): string {
  let type = field.typeName;
  if (field.list) {
    type += '[]';
  } else if (field.optional) {
    type += '?';
  }
  return type;
}
