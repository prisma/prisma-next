import type { ColumnDefault } from '@prisma-next/contract/types';
import type { SqlSchemaIR, SqlTableIR } from '@prisma-next/sql-schema-ir/types';
import { mapDefault } from './default-mapping';
import { toEnumName, toFieldName, toModelName, toNamedTypeName } from './name-transforms';
import { extractEnumDefinitions, extractEnumTypeNames } from './postgres-type-map';
import { parseRawDefault } from './raw-default-parser';
import { inferRelations } from './relation-inference';
import type {
  PrinterField,
  PrinterModel,
  PrinterNamedType,
  PslPrinterOptions,
  RelationField,
} from './types';

const DEFAULT_HEADER = '// This file was introspected from the database. Do not edit manually.';

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
export function printPsl(schemaIR: SqlSchemaIR, options: PslPrinterOptions): string {
  const { typeMap, header } = options;
  const headerComment = header ?? DEFAULT_HEADER;

  // Extract enum info from annotations
  const enumTypeNames = extractEnumTypeNames(schemaIR.annotations);
  const enumDefinitions = extractEnumDefinitions(schemaIR.annotations);

  // Build model name mapping (db table name → PSL model name)
  const modelNameMap = new Map<string, string>();
  for (const tableName of Object.keys(schemaIR.tables)) {
    const { name } = toModelName(tableName);
    modelNameMap.set(tableName, name);
  }

  // Build enum name mapping (db type name → PSL enum name)
  const enumNameMap = new Map<string, string>();
  for (const pgTypeName of enumTypeNames) {
    const { name } = toEnumName(pgTypeName);
    enumNameMap.set(pgTypeName, name);
  }

  // Infer relations from foreign keys
  const { relationsByTable } = inferRelations(schemaIR.tables, modelNameMap);

  // Collect named types for the types block
  const namedTypes = new Map<string, PrinterNamedType>();

  // Process tables into models
  const models: PrinterModel[] = [];
  for (const table of Object.values(schemaIR.tables)) {
    const model = processTable(
      table,
      typeMap,
      enumNameMap,
      namedTypes,
      relationsByTable.get(table.name) ?? [],
    );
    models.push(model);
  }

  // Process enums
  const enums: Array<{ name: string; mapName: string | undefined; values: readonly string[] }> = [];
  for (const [pgTypeName, values] of enumDefinitions) {
    const { name, map } = toEnumName(pgTypeName);
    enums.push({ name, mapName: map, values });
  }

  // Sort enums alphabetically
  enums.sort((a, b) => a.name.localeCompare(b.name));

  // Sort models topologically by FK dependencies
  const sortedModels = topologicalSort(models, schemaIR.tables);

  // Serialize
  const sections: string[] = [];

  // Header
  sections.push(headerComment);

  // Types block
  const namedTypeEntries = [...namedTypes.values()].sort((a, b) => a.name.localeCompare(b.name));
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

  return sections.join('\n\n') + '\n';
}

/**
 * Processes a SQL table into a PrinterModel.
 */
function processTable(
  table: SqlTableIR,
  typeMap: PslPrinterOptions['typeMap'],
  enumNameMap: ReadonlyMap<string, string>,
  namedTypes: Map<string, PrinterNamedType>,
  relationFields: readonly RelationField[],
): PrinterModel {
  const { name: modelName, map: mapName } = toModelName(table.name);

  const pkColumns = new Set(table.primaryKey?.columns ?? []);
  const isSinglePk = pkColumns.size === 1;

  // Build set of unique single-column constraints
  const uniqueColumns = new Set<string>();
  for (const unique of table.uniques) {
    if (unique.columns.length === 1) {
      uniqueColumns.add(unique.columns[0]!);
    }
  }

  // Process columns into fields
  const fields: PrinterField[] = [];
  const columnEntries = Object.values(table.columns);

  for (const column of columnEntries) {
    const { name: fieldName, map: fieldMap } = toFieldName(column.name);

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

    // Handle parameterized types → named type in types block
    if (resolution.typeParams && !enumPslName) {
      const namedTypeName = toNamedTypeName(column.name);
      if (!namedTypes.has(namedTypeName)) {
        namedTypes.set(namedTypeName, {
          name: namedTypeName,
          baseType: resolution.pslType,
        });
      }
      typeName = namedTypeName;
    }

    // Build attributes
    const attributes: string[] = [];
    const isId = isSinglePk && pkColumns.has(column.name);
    if (isId) {
      attributes.push('@id');
    }

    // Default value
    let comment: string | undefined;
    if (column.default !== undefined) {
      const parsed = parseDefaultIfNeeded(column.default);
      if (parsed) {
        const result = mapDefault(parsed);
        if ('attribute' in result) {
          attributes.push(result.attribute);
        } else {
          comment = result.comment;
        }
      }
    }

    // Unique
    if (uniqueColumns.has(column.name) && !isId) {
      attributes.push('@unique');
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
  for (const rel of relationFields) {
    const relAttributes: string[] = [];

    if (rel.fields && rel.references) {
      const parts: string[] = [];
      if (rel.relationName) {
        parts.push(`name: "${rel.relationName}"`);
      }
      parts.push(`fields: [${rel.fields.map((f) => toFieldName(f).name).join(', ')}]`);
      parts.push(`references: [${rel.references.map((r) => toFieldName(r).name).join(', ')}]`);
      if (rel.onDelete) {
        parts.push(`onDelete: ${rel.onDelete}`);
      }
      if (rel.onUpdate) {
        parts.push(`onUpdate: ${rel.onUpdate}`);
      }
      relAttributes.push(`@relation(${parts.join(', ')})`);
    } else if (rel.relationName) {
      relAttributes.push(`@relation(name: "${rel.relationName}")`);
    }

    fields.push({
      name: rel.fieldName,
      typeName: rel.typeName,
      optional: rel.optional,
      list: rel.list,
      attributes: relAttributes,
      isId: false,
      isRelation: true,
      isUnsupported: false,
    });
  }

  // Model-level attributes
  const modelAttributes: string[] = [];

  // Composite PK
  if (table.primaryKey && table.primaryKey.columns.length > 1) {
    const pkFieldNames = table.primaryKey.columns.map((c) => toFieldName(c).name);
    modelAttributes.push(`@@id([${pkFieldNames.join(', ')}])`);
  }

  // Composite unique constraints
  for (const unique of table.uniques) {
    if (unique.columns.length > 1) {
      const fieldNames = unique.columns.map((c) => toFieldName(c).name);
      modelAttributes.push(`@@unique([${fieldNames.join(', ')}])`);
    }
  }

  // Indexes (non-unique only; unique indexes are handled by @@unique)
  for (const index of table.indexes) {
    if (!index.unique) {
      const fieldNames = index.columns.map((c) => toFieldName(c).name);
      modelAttributes.push(`@@index([${fieldNames.join(', ')}])`);
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
function parseDefaultIfNeeded(value: unknown): ColumnDefault | undefined {
  if (typeof value === 'object' && value !== null && 'kind' in value) {
    return value as ColumnDefault;
  }
  if (typeof value === 'string') {
    return parseRawDefault(value);
  }
  return undefined;
}

/**
 * Topologically sorts models by FK dependencies.
 * Parent tables (those referenced by FKs) come before child tables.
 * Alphabetical fallback for cycles.
 */
function topologicalSort(
  models: PrinterModel[],
  tables: Record<string, SqlTableIR>,
): PrinterModel[] {
  const modelByName = new Map<string, PrinterModel>();
  for (const model of models) {
    modelByName.set(model.name, model);
  }

  // Build adjacency: model name → set of model names it depends on (via FK)
  const deps = new Map<string, Set<string>>();
  const tableToModel = new Map<string, string>();
  for (const tableName of Object.keys(tables)) {
    const modelName = toModelName(tableName).name;
    tableToModel.set(tableName, modelName);
    deps.set(modelName, new Set());
  }

  for (const [tableName, table] of Object.entries(tables)) {
    const modelName = tableToModel.get(tableName)!;
    for (const fk of table.foreignKeys) {
      const refModelName = tableToModel.get(fk.referencedTable);
      if (refModelName && refModelName !== modelName) {
        deps.get(modelName)!.add(refModelName);
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
    const depSet = deps.get(name);
    if (depSet) {
      const sortedDeps = [...depSet].sort();
      for (const dep of sortedDeps) {
        visit(dep);
      }
    }

    visiting.delete(name);
    visited.add(name);
    const model = modelByName.get(name);
    if (model) {
      result.push(model);
    }
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
    lines.push(`  ${nt.name} = ${nt.baseType}`);
  }
  lines.push('}');
  return lines.join('\n');
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
  for (const value of e.values) {
    lines.push(`  ${value}`);
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
