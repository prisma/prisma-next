import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getPrismaConfig, getPrismaDmmf } from './prisma-wasm';
import { sanitizePrismaSchemaForPrisma7 } from './schema-normalize';
import type {
  ContractColumnDefault,
  ConvertPrismaSchemaOptions,
  ConvertPrismaSchemaResult,
  LoadedPrismaSchemaSource,
  PrismaContractColumn,
  PrismaContractIR,
  PrismaContractTable,
  PrismaExecutionDefault,
  PrismaRelationDefinition,
  PrismaStorageTypeInstance,
} from './types';

const PG_TEXT_CODEC_ID = 'pg/text@1';
const PG_ENUM_CODEC_ID = 'pg/enum@1';
const SQL_CHAR_CODEC_ID = 'sql/char@1';
const SQL_VARCHAR_CODEC_ID = 'sql/varchar@1';
const PG_INT2_CODEC_ID = 'pg/int2@1';
const PG_INT4_CODEC_ID = 'pg/int4@1';
const PG_INT8_CODEC_ID = 'pg/int8@1';
const PG_FLOAT4_CODEC_ID = 'pg/float4@1';
const PG_FLOAT8_CODEC_ID = 'pg/float8@1';
const PG_NUMERIC_CODEC_ID = 'pg/numeric@1';
const PG_BOOL_CODEC_ID = 'pg/bool@1';
const PG_BIT_CODEC_ID = 'pg/bit@1';
const PG_VARBIT_CODEC_ID = 'pg/varbit@1';
const PG_TIME_CODEC_ID = 'pg/time@1';
const PG_TIMETZ_CODEC_ID = 'pg/timetz@1';
const PG_TIMESTAMP_CODEC_ID = 'pg/timestamp@1';
const PG_TIMESTAMPTZ_CODEC_ID = 'pg/timestamptz@1';
const PG_JSON_CODEC_ID = 'pg/json@1';
const PG_JSONB_CODEC_ID = 'pg/jsonb@1';

const DEFAULT_CAPABILITIES: Record<string, Record<string, boolean>> = {
  postgres: {
    orderBy: true,
    limit: true,
    lateral: true,
    jsonAgg: true,
    returning: true,
  },
  sql: {
    enums: true,
  },
};

interface PrismaInternalsGetConfigResult {
  readonly datasources?: ReadonlyArray<{
    readonly provider?: string;
    readonly activeProvider?: string;
  }>;
}

interface DmmfField {
  readonly name: string;
  readonly dbName?: string | null;
  readonly kind: 'scalar' | 'enum' | 'object';
  readonly isList: boolean;
  readonly isRequired: boolean;
  readonly isUnique: boolean;
  readonly isId: boolean;
  readonly type: string;
  readonly nativeType?: [string, string[]] | null;
  readonly default?: unknown;
  readonly hasDefaultValue: boolean;
  readonly isUpdatedAt: boolean;
  readonly relationName?: string;
  readonly relationFromFields?: ReadonlyArray<string>;
  readonly relationToFields?: ReadonlyArray<string>;
  readonly relationOnDelete?: string;
  readonly relationOnUpdate?: string;
}

interface DmmfPrimaryKey {
  readonly name?: string | null;
  readonly fields: ReadonlyArray<string>;
}

interface DmmfModel {
  readonly name: string;
  readonly dbName?: string | null;
  readonly schema?: string | null;
  readonly fields: ReadonlyArray<DmmfField>;
  readonly primaryKey?: DmmfPrimaryKey | null;
}

interface DmmfEnumValue {
  readonly name: string;
  readonly dbName?: string | null;
}

interface DmmfEnum {
  readonly name: string;
  readonly dbName?: string | null;
  readonly values: ReadonlyArray<DmmfEnumValue>;
}

interface DmmfIndexField {
  readonly name: string;
  readonly sortOrder?: string;
  readonly operatorClass?: string;
  readonly length?: number;
}

interface DmmfIndex {
  readonly model: string;
  readonly type: 'id' | 'unique' | 'normal' | 'fulltext';
  readonly isDefinedOnField: boolean;
  readonly dbName?: string;
  readonly algorithm?: string;
  readonly fields: ReadonlyArray<DmmfIndexField>;
}

interface DmmfDatamodel {
  readonly models: ReadonlyArray<DmmfModel>;
  readonly enums: ReadonlyArray<DmmfEnum>;
  readonly indexes: ReadonlyArray<DmmfIndex>;
  readonly types?: ReadonlyArray<unknown>;
}

interface PrismaInternalsDmmfResult {
  readonly datamodel: DmmfDatamodel;
}

interface ModelContext {
  readonly model: DmmfModel;
  readonly tableName: string;
  readonly fieldToColumn: Map<string, string>;
  readonly columns: Record<string, PrismaContractColumn>;
}

interface ImplicitManyToManySide {
  readonly model: DmmfModel;
  readonly field: DmmfField;
}

interface DefaultConversionResult {
  readonly columnDefault?: ContractColumnDefault;
  readonly executionDefault?: PrismaExecutionDefault;
}

export async function loadPrismaSchemaSource(
  options: ConvertPrismaSchemaOptions,
): Promise<LoadedPrismaSchemaSource> {
  if (options.schema && options.schema.trim().length > 0) {
    const sourcePath = options.schemaPath ? resolve(options.schemaPath) : '<inline-schema>';
    return {
      schemaPath: sourcePath,
      schema: options.schema,
      sanitizedSchema: sanitizePrismaSchemaForPrisma7(options.schema),
    };
  }

  if (!options.schemaPath) {
    throw new Error('Prisma schema source requires `schemaPath` or inline `schema` content.');
  }

  const absolutePath = resolve(options.schemaPath);
  const schema = await readFile(absolutePath, 'utf8');
  return {
    schemaPath: absolutePath,
    schema,
    sanitizedSchema: sanitizePrismaSchemaForPrisma7(schema),
  };
}

export async function convertPrismaSchemaToContract(
  options: ConvertPrismaSchemaOptions,
): Promise<ConvertPrismaSchemaResult> {
  const loaded = await loadPrismaSchemaSource(options);
  const missingFeatures = new Set<string>();
  collectSchemaLevelFeatureGaps(loaded.schema, missingFeatures);

  const config = getPrismaConfig<PrismaInternalsGetConfigResult>(loaded.sanitizedSchema);
  const provider = resolveProvider(config);
  if (provider !== 'postgresql') {
    throw new Error(
      `Unsupported Prisma datasource provider "${provider}". Prisma Next PSL import currently supports postgresql schemas.`,
    );
  }

  const dmmf = getPrismaDmmf<PrismaInternalsDmmfResult>(loaded.sanitizedSchema);
  const datamodel = dmmf.datamodel;

  if (datamodel.types && datamodel.types.length > 0) {
    missingFeatures.add(
      'Composite types are not represented in SQL contract output and are ignored.',
    );
  }

  const modelContexts = new Map<string, ModelContext>();
  const tables: PrismaContractIR['storage']['tables'] = {};
  const models: PrismaContractIR['models'] = {};
  const tableRelations: PrismaContractIR['relations'] = {};
  const storageTypes: Record<string, PrismaStorageTypeInstance> = {};
  const executionDefaults: PrismaExecutionDefault[] = [];

  for (const enumType of datamodel.enums) {
    const enumName = enumType.name;
    const nativeType = enumType.dbName ?? enumType.name;
    storageTypes[enumName] = {
      codecId: PG_ENUM_CODEC_ID,
      nativeType,
      typeParams: {
        values: enumType.values.map((value) => value.dbName ?? value.name),
      },
    };
  }

  const indexesByModel = groupIndexesByModel(datamodel.indexes);
  for (const model of datamodel.models) {
    const tableName = model.dbName ?? model.name;
    const fieldToColumn = new Map<string, string>();
    const columns: Record<string, PrismaContractColumn> = {};
    const modelRelations: Record<string, PrismaRelationDefinition> = {};
    const tableLevelRelations: Record<string, PrismaRelationDefinition> = {};

    for (const field of model.fields) {
      if (field.kind !== 'scalar' && field.kind !== 'enum') {
        continue;
      }

      const columnName = field.dbName ?? field.name;
      fieldToColumn.set(field.name, columnName);

      const enumType =
        field.kind === 'enum' ? datamodel.enums.find((e) => e.name === field.type) : undefined;
      const column = convertFieldToColumn({
        field,
        tableName,
        columnName,
        missingFeatures,
        ...(enumType ? { enumType } : {}),
      });

      columns[columnName] = column.column;
      if (column.executionDefault) {
        executionDefaults.push(column.executionDefault);
      }
    }

    const table: PrismaContractTable = {
      columns,
      uniques: [] as Array<{ columns: string[]; name?: string }>,
      indexes: [] as Array<{ columns: string[]; name?: string }>,
      foreignKeys: [] as Array<{
        columns: string[];
        references: { table: string; columns: string[] };
        name?: string;
      }>,
    };

    const modelIndexes = indexesByModel.get(model.name) ?? [];
    for (const index of modelIndexes) {
      const mappedColumns = mapIndexFields(index.fields, fieldToColumn);
      if (mappedColumns.length === 0) {
        continue;
      }

      if (
        index.algorithm ||
        index.fields.some(
          (field) => field.sortOrder || field.operatorClass || typeof field.length === 'number',
        )
      ) {
        missingFeatures.add(
          `Index options on ${model.name} (${index.dbName ?? mappedColumns.join(',')}) are not preserved in contract indexes.`,
        );
      }

      if (index.type === 'id') {
        table.primaryKey = {
          columns: mappedColumns,
          ...(index.dbName ? { name: index.dbName } : {}),
        };
        continue;
      }

      if (index.type === 'unique') {
        table.uniques.push({
          columns: mappedColumns,
          ...(index.dbName ? { name: index.dbName } : {}),
        });
        continue;
      }

      table.indexes.push({
        columns: mappedColumns,
        ...(index.dbName ? { name: index.dbName } : {}),
      });
      if (index.type === 'fulltext') {
        missingFeatures.add(
          `Fulltext index ${index.dbName ?? mappedColumns.join(',')} on ${model.name} is downgraded to a regular index in contract output.`,
        );
      }
    }

    if (!table.primaryKey && model.primaryKey && model.primaryKey.fields.length > 0) {
      const pkColumns = model.primaryKey.fields
        .map((fieldName) => fieldToColumn.get(fieldName))
        .filter((name): name is string => typeof name === 'string');
      if (pkColumns.length > 0) {
        table.primaryKey = {
          columns: pkColumns,
          ...(model.primaryKey.name ? { name: model.primaryKey.name } : {}),
        };
      }
    }

    tables[tableName] = table;
    models[model.name] = {
      storage: { table: tableName },
      fields: buildModelFieldMapping(model.fields, fieldToColumn),
      relations: modelRelations,
    };
    tableRelations[tableName] = tableLevelRelations;
    modelContexts.set(model.name, {
      model,
      tableName,
      fieldToColumn,
      columns,
    });
  }

  buildRelationsAndForeignKeys({
    modelContexts,
    datamodel,
    tables,
    models,
    tableRelations,
    indexesByModel,
    missingFeatures,
  });

  buildImplicitManyToManyTables({
    datamodel,
    modelContexts,
    tables,
    models,
    tableRelations,
    missingFeatures,
  });

  const contract: PrismaContractIR = {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: 'sha256:prisma-schema-source',
    models,
    relations: tableRelations,
    storage: {
      tables,
      ...(Object.keys(storageTypes).length > 0 ? { types: storageTypes } : {}),
    },
    ...(executionDefaults.length > 0
      ? {
          execution: {
            mutations: {
              defaults: executionDefaults.sort((a, b) => {
                const tableCompare = a.ref.table.localeCompare(b.ref.table);
                if (tableCompare !== 0) {
                  return tableCompare;
                }
                return a.ref.column.localeCompare(b.ref.column);
              }),
            },
          },
        }
      : {}),
    extensionPacks: {},
    capabilities: DEFAULT_CAPABILITIES,
    meta: {
      prismaPsl: {
        provider,
        schemaPath: loaded.schemaPath,
        missingFeatures: Array.from(missingFeatures).sort(),
      },
    },
    sources: {},
  };

  return {
    contract,
    provider,
    missingFeatures: Array.from(missingFeatures).sort(),
    sanitizedSchema: loaded.sanitizedSchema,
  };
}

function resolveProvider(config: PrismaInternalsGetConfigResult): string {
  const datasource = config.datasources?.[0];
  if (!datasource) {
    throw new Error('No datasource block found in Prisma schema.');
  }

  return datasource.activeProvider ?? datasource.provider ?? '';
}

function collectSchemaLevelFeatureGaps(schema: string, missingFeatures: Set<string>): void {
  if (/Unsupported\s*\(/.test(schema)) {
    missingFeatures.add(
      'Unsupported(...) fields are currently dropped by Prisma DMMF and cannot be represented in generated contracts.',
    );
  }
  if (/^\s*view\s+\w+\s*\{/m.test(schema)) {
    missingFeatures.add('Prisma view blocks are not represented in SQL contract storage output.');
  }
  if (/@@schema\s*\(/.test(schema)) {
    missingFeatures.add(
      'Multi-schema model placement is not preserved; tables are emitted in a single schema.',
    );
  }
  if (/^\s*schemas\s*=/.test(schema)) {
    missingFeatures.add(
      'Datasource schemas configuration is not preserved in contract output metadata.',
    );
  }
}

function buildModelFieldMapping(
  fields: ReadonlyArray<DmmfField>,
  fieldToColumn: Map<string, string>,
): Record<string, { readonly column: string }> {
  const mapping: Record<string, { readonly column: string }> = {};
  for (const field of fields) {
    if (field.kind !== 'scalar' && field.kind !== 'enum') {
      continue;
    }
    const column = fieldToColumn.get(field.name);
    if (!column) {
      continue;
    }
    mapping[field.name] = { column };
  }
  return mapping;
}

function groupIndexesByModel(indexes: ReadonlyArray<DmmfIndex>): Map<string, DmmfIndex[]> {
  const grouped = new Map<string, DmmfIndex[]>();
  for (const index of indexes) {
    const arr = grouped.get(index.model);
    if (arr) {
      arr.push(index);
    } else {
      grouped.set(index.model, [index]);
    }
  }
  return grouped;
}

function mapIndexFields(
  fields: ReadonlyArray<DmmfIndexField>,
  fieldToColumn: Map<string, string>,
): string[] {
  const mapped: string[] = [];
  for (const field of fields) {
    const column = fieldToColumn.get(field.name);
    if (!column) {
      continue;
    }
    mapped.push(column);
  }
  return mapped;
}

function buildRelationsAndForeignKeys(input: {
  readonly modelContexts: Map<string, ModelContext>;
  readonly datamodel: DmmfDatamodel;
  readonly tables: PrismaContractIR['storage']['tables'];
  readonly models: PrismaContractIR['models'];
  readonly tableRelations: PrismaContractIR['relations'];
  readonly indexesByModel: Map<string, DmmfIndex[]>;
  readonly missingFeatures: Set<string>;
}): void {
  const {
    modelContexts,
    datamodel,
    tables,
    models,
    tableRelations,
    indexesByModel,
    missingFeatures,
  } = input;

  for (const context of modelContexts.values()) {
    for (const field of context.model.fields) {
      if (field.kind !== 'object') {
        continue;
      }

      const fromFields = field.relationFromFields ?? [];
      const toFields = field.relationToFields ?? [];
      if (fromFields.length === 0 || toFields.length === 0) {
        continue;
      }

      const parentContext = modelContexts.get(field.type);
      if (!parentContext) {
        continue;
      }

      const childColumns = fromFields
        .map((name) => context.fieldToColumn.get(name))
        .filter((value): value is string => typeof value === 'string');
      const parentColumns = toFields
        .map((name) => parentContext.fieldToColumn.get(name))
        .filter((value): value is string => typeof value === 'string');

      if (childColumns.length === 0 || parentColumns.length === 0) {
        continue;
      }

      const table = tables[context.tableName];
      if (!table) {
        continue;
      }

      const existingFk = table.foreignKeys.find(
        (fk) =>
          arraysEqual(fk.columns, childColumns) &&
          fk.references.table === parentContext.tableName &&
          arraysEqual(fk.references.columns, parentColumns),
      );
      if (!existingFk) {
        table.foreignKeys.push({
          columns: childColumns,
          references: {
            table: parentContext.tableName,
            columns: parentColumns,
          },
        });
      }

      if (field.relationOnDelete || field.relationOnUpdate) {
        missingFeatures.add(
          `Foreign key referential actions on relation ${context.model.name}.${field.name} are not preserved in SQL contract foreignKeys.`,
        );
      }

      const childCardinality = isColumnSetUnique(
        context.model.name,
        childColumns,
        indexesByModel,
        context.fieldToColumn,
      )
        ? '1:1'
        : 'N:1';

      const childRelation = {
        to: parentContext.model.name,
        cardinality: childCardinality,
        on: {
          parentCols: parentColumns,
          childCols: childColumns,
        },
      } satisfies PrismaRelationDefinition;
      const childModel = models[context.model.name];
      const childTableRelations = tableRelations[context.tableName];
      if (!childModel || !childTableRelations) {
        continue;
      }
      childModel.relations[field.name] = childRelation;
      childTableRelations[field.name] = childRelation;

      const oppositeFields = parentContext.model.fields.filter(
        (candidate) =>
          candidate.kind === 'object' &&
          candidate.relationName === field.relationName &&
          (candidate.relationFromFields?.length ?? 0) === 0,
      );
      for (const opposite of oppositeFields) {
        const oppositeRelation = {
          to: context.model.name,
          cardinality: opposite.isList ? '1:N' : '1:1',
          on: {
            parentCols: parentColumns,
            childCols: childColumns,
          },
        } satisfies PrismaRelationDefinition;
        const parentModel = models[parentContext.model.name];
        const parentTableRelations = tableRelations[parentContext.tableName];
        if (!parentModel || !parentTableRelations) {
          continue;
        }
        parentModel.relations[opposite.name] = oppositeRelation;
        parentTableRelations[opposite.name] = oppositeRelation;
      }
    }
  }

  for (const model of datamodel.models) {
    if (model.schema) {
      missingFeatures.add(
        `Model ${model.name} is assigned to schema ${model.schema}; schema assignment is not preserved in table metadata.`,
      );
    }
  }
}

function buildImplicitManyToManyTables(input: {
  readonly datamodel: DmmfDatamodel;
  readonly modelContexts: Map<string, ModelContext>;
  readonly tables: PrismaContractIR['storage']['tables'];
  readonly models: PrismaContractIR['models'];
  readonly tableRelations: PrismaContractIR['relations'];
  readonly missingFeatures: Set<string>;
}): void {
  const { datamodel, modelContexts, tables, models, tableRelations, missingFeatures } = input;

  const grouped = new Map<string, ImplicitManyToManySide[]>();
  for (const model of datamodel.models) {
    for (const field of model.fields) {
      if (field.kind !== 'object') {
        continue;
      }
      const relationFromFields = field.relationFromFields ?? [];
      const relationToFields = field.relationToFields ?? [];
      if (!field.isList || relationFromFields.length > 0 || relationToFields.length > 0) {
        continue;
      }
      const relationName = field.relationName;
      if (!relationName) {
        continue;
      }
      const group = grouped.get(relationName);
      if (group) {
        group.push({ model, field });
      } else {
        grouped.set(relationName, [{ model, field }]);
      }
    }
  }

  for (const [relationName, sides] of grouped) {
    if (sides.length !== 2) {
      continue;
    }
    const [left, right] = sides;
    if (!left || !right || left.model.name === right.model.name) {
      continue;
    }

    const ordered = [left, right].sort((a, b) => a.model.name.localeCompare(b.model.name));
    const sideA = ordered[0];
    const sideB = ordered[1];
    if (!sideA || !sideB) {
      continue;
    }

    const idA = getSingleIdColumn(sideA.model, modelContexts);
    const idB = getSingleIdColumn(sideB.model, modelContexts);
    if (!idA || !idB) {
      missingFeatures.add(
        `Implicit many-to-many relation ${relationName} requires single-column IDs on both models. Relation was skipped.`,
      );
      continue;
    }

    const joinTableName = `_${relationName}`;
    if (!tables[joinTableName]) {
      const { default: _idADefault, ...idAColumnNoDefault } = idA.column;
      const { default: _idBDefault, ...idBColumnNoDefault } = idB.column;
      tables[joinTableName] = {
        columns: {
          A: { ...idAColumnNoDefault, nullable: false },
          B: { ...idBColumnNoDefault, nullable: false },
        },
        uniques: [
          {
            columns: ['A', 'B'],
            name: `${joinTableName}_AB_unique`,
          },
        ],
        indexes: [
          {
            columns: ['B'],
            name: `${joinTableName}_B_index`,
          },
        ],
        foreignKeys: [
          {
            columns: ['A'],
            references: {
              table: idA.tableName,
              columns: [idA.columnName],
            },
          },
          {
            columns: ['B'],
            references: {
              table: idB.tableName,
              columns: [idB.columnName],
            },
          },
        ],
      };
      tableRelations[joinTableName] = {};
    }

    const relationA = {
      to: sideB.model.name,
      cardinality: 'N:M',
      on: {
        parentCols: [idA.columnName],
        childCols: [idB.columnName],
      },
      through: {
        table: joinTableName,
        parentCols: ['A'],
        childCols: ['B'],
      },
    } satisfies PrismaRelationDefinition;
    const sideAModel = models[sideA.model.name];
    const sideATableRelations = tableRelations[idA.tableName];
    if (!sideAModel || !sideATableRelations) {
      continue;
    }
    sideAModel.relations[sideA.field.name] = relationA;
    sideATableRelations[sideA.field.name] = relationA;

    const relationB = {
      to: sideA.model.name,
      cardinality: 'N:M',
      on: {
        parentCols: [idB.columnName],
        childCols: [idA.columnName],
      },
      through: {
        table: joinTableName,
        parentCols: ['B'],
        childCols: ['A'],
      },
    } satisfies PrismaRelationDefinition;
    const sideBModel = models[sideB.model.name];
    const sideBTableRelations = tableRelations[idB.tableName];
    if (!sideBModel || !sideBTableRelations) {
      continue;
    }
    sideBModel.relations[sideB.field.name] = relationB;
    sideBTableRelations[sideB.field.name] = relationB;
  }
}

function getSingleIdColumn(
  model: DmmfModel,
  modelContexts: Map<string, ModelContext>,
): {
  readonly tableName: string;
  readonly columnName: string;
  readonly column: PrismaContractColumn;
} | null {
  const context = modelContexts.get(model.name);
  if (!context) {
    return null;
  }

  const idFields = model.fields.filter((field) => field.kind === 'scalar' && field.isId);
  if (idFields.length === 1 && idFields[0]) {
    const idField = idFields[0];
    const columnName = context.fieldToColumn.get(idField.name);
    if (!columnName) {
      return null;
    }
    const column = context.columns[columnName];
    if (!column) {
      return null;
    }
    return {
      tableName: context.tableName,
      columnName,
      column,
    };
  }

  const primaryKey = model.primaryKey;
  if (!primaryKey || primaryKey.fields.length !== 1) {
    return null;
  }

  const fieldName = primaryKey.fields[0];
  if (!fieldName) {
    return null;
  }
  const columnName = context.fieldToColumn.get(fieldName);
  if (!columnName) {
    return null;
  }
  const column = context.columns[columnName];
  if (!column) {
    return null;
  }

  return {
    tableName: context.tableName,
    columnName,
    column,
  };
}

function isColumnSetUnique(
  modelName: string,
  columns: readonly string[],
  indexesByModel: Map<string, DmmfIndex[]>,
  fieldToColumn: Map<string, string>,
): boolean {
  const indexes = indexesByModel.get(modelName) ?? [];
  for (const index of indexes) {
    if (index.type !== 'id' && index.type !== 'unique') {
      continue;
    }
    const indexColumns = mapIndexFields(index.fields, fieldToColumn);
    if (arraysEqual(indexColumns, columns)) {
      return true;
    }
  }
  return false;
}

function convertFieldToColumn(input: {
  readonly field: DmmfField;
  readonly enumType?: DmmfEnum;
  readonly tableName: string;
  readonly columnName: string;
  readonly missingFeatures: Set<string>;
}): { readonly column: PrismaContractColumn; readonly executionDefault?: PrismaExecutionDefault } {
  const { field, enumType, tableName, columnName, missingFeatures } = input;

  const native = resolveNativeType(field, enumType, missingFeatures);
  const codecId =
    field.kind === 'enum'
      ? PG_ENUM_CODEC_ID
      : resolveCodecId(native.baseNativeType, field.type, missingFeatures, tableName, columnName);

  const defaultConversion = convertDefault({
    field,
    tableName,
    columnName,
    missingFeatures,
  });

  const column: PrismaContractColumn = {
    nativeType: field.isList ? `${native.baseNativeType}[]` : native.baseNativeType,
    codecId,
    nullable: !field.isRequired,
    ...(native.typeParams ? { typeParams: native.typeParams } : {}),
    ...(field.kind === 'enum' ? { typeRef: enumType?.name ?? field.type } : {}),
    ...(defaultConversion.columnDefault ? { default: defaultConversion.columnDefault } : {}),
  };

  if (field.isList) {
    missingFeatures.add(
      `List field ${tableName}.${columnName} is represented as ${column.nativeType}, but list-aware codecs are not yet implemented.`,
    );
  }

  return {
    column,
    ...(defaultConversion.executionDefault
      ? { executionDefault: defaultConversion.executionDefault }
      : {}),
  };
}

function resolveNativeType(
  field: DmmfField,
  enumType: DmmfEnum | undefined,
  missingFeatures: Set<string>,
): { readonly baseNativeType: string; readonly typeParams?: Record<string, unknown> | undefined } {
  if (field.kind === 'enum') {
    return {
      baseNativeType: enumType?.dbName ?? enumType?.name ?? field.type,
    };
  }

  if (field.nativeType?.[0]) {
    const [name, rawArgs] = field.nativeType;
    const args = Array.isArray(rawArgs) ? rawArgs : [];
    return mapNativeType(name, args, field.type, missingFeatures);
  }

  return mapDefaultScalarNativeType(field.type, missingFeatures);
}

function mapNativeType(
  name: string,
  args: readonly string[],
  scalarType: string,
  missingFeatures: Set<string>,
): { readonly baseNativeType: string; readonly typeParams?: Record<string, unknown> | undefined } {
  switch (name) {
    case 'SmallInt':
      return { baseNativeType: 'int2' };
    case 'Integer':
      return { baseNativeType: 'int4' };
    case 'BigInt':
      return { baseNativeType: 'int8' };
    case 'Real':
      return { baseNativeType: 'float4' };
    case 'DoublePrecision':
      return { baseNativeType: 'float8' };
    case 'Decimal':
      return {
        baseNativeType: 'numeric',
        typeParams: toNumericTypeParams(args),
      };
    case 'VarChar':
      return {
        baseNativeType: 'character varying',
        typeParams: toLengthTypeParams(args),
      };
    case 'Char':
      return {
        baseNativeType: 'character',
        typeParams: toLengthTypeParams(args),
      };
    case 'Bit':
      return {
        baseNativeType: 'bit',
        typeParams: toLengthTypeParams(args),
      };
    case 'VarBit':
      return {
        baseNativeType: 'bit varying',
        typeParams: toLengthTypeParams(args),
      };
    case 'Timestamp':
      return {
        baseNativeType: 'timestamp',
        typeParams: toPrecisionTypeParams(args),
      };
    case 'Timestamptz':
      return {
        baseNativeType: 'timestamptz',
        typeParams: toPrecisionTypeParams(args),
      };
    case 'Time':
      return {
        baseNativeType: 'time',
        typeParams: toPrecisionTypeParams(args),
      };
    case 'Timetz':
      return {
        baseNativeType: 'timetz',
        typeParams: toPrecisionTypeParams(args),
      };
    case 'Date':
      return { baseNativeType: 'date' };
    case 'Text':
      return { baseNativeType: 'text' };
    case 'Boolean':
      return { baseNativeType: 'bool' };
    case 'Json':
      return { baseNativeType: 'json' };
    case 'JsonB':
      return { baseNativeType: 'jsonb' };
    case 'ByteA':
      return { baseNativeType: 'bytea' };
    case 'Uuid':
      return { baseNativeType: 'uuid' };
    case 'Xml':
      return { baseNativeType: 'xml' };
    case 'Money':
      return { baseNativeType: 'money' };
    case 'Inet':
      return { baseNativeType: 'inet' };
    case 'Oid':
      return { baseNativeType: 'oid' };
    case 'Citext':
      return { baseNativeType: 'citext' };
    default:
      missingFeatures.add(
        `Native type ${name} for scalar ${scalarType} is mapped as lowercase fallback and may need custom codec support.`,
      );
      return { baseNativeType: name.toLowerCase() };
  }
}

function mapDefaultScalarNativeType(
  scalarType: string,
  missingFeatures: Set<string>,
): { readonly baseNativeType: string } {
  switch (scalarType) {
    case 'String':
      return { baseNativeType: 'text' };
    case 'Int':
      return { baseNativeType: 'int4' };
    case 'BigInt':
      return { baseNativeType: 'int8' };
    case 'Float':
      return { baseNativeType: 'float8' };
    case 'Decimal':
      return { baseNativeType: 'numeric' };
    case 'Boolean':
      return { baseNativeType: 'bool' };
    case 'DateTime':
      return { baseNativeType: 'timestamptz' };
    case 'Json':
      return { baseNativeType: 'jsonb' };
    case 'Bytes':
      return { baseNativeType: 'bytea' };
    default:
      missingFeatures.add(
        `Scalar type ${scalarType} is not recognized by default mapper. Falling back to text.`,
      );
      return { baseNativeType: 'text' };
  }
}

function resolveCodecId(
  nativeType: string,
  scalarType: string,
  missingFeatures: Set<string>,
  tableName: string,
  columnName: string,
): string {
  if (nativeType === 'int2') return PG_INT2_CODEC_ID;
  if (nativeType === 'int4') return PG_INT4_CODEC_ID;
  if (nativeType === 'int8') return PG_INT8_CODEC_ID;
  if (nativeType === 'float4') return PG_FLOAT4_CODEC_ID;
  if (nativeType === 'float8') return PG_FLOAT8_CODEC_ID;
  if (nativeType === 'numeric') return PG_NUMERIC_CODEC_ID;
  if (nativeType === 'bool') return PG_BOOL_CODEC_ID;
  if (nativeType === 'bit') return PG_BIT_CODEC_ID;
  if (nativeType === 'bit varying') return PG_VARBIT_CODEC_ID;
  if (nativeType === 'time') return PG_TIME_CODEC_ID;
  if (nativeType === 'timetz') return PG_TIMETZ_CODEC_ID;
  if (nativeType === 'timestamp') return PG_TIMESTAMP_CODEC_ID;
  if (nativeType === 'timestamptz') return PG_TIMESTAMPTZ_CODEC_ID;
  if (nativeType === 'json') return PG_JSON_CODEC_ID;
  if (nativeType === 'jsonb') return PG_JSONB_CODEC_ID;
  if (nativeType === 'character') return SQL_CHAR_CODEC_ID;
  if (nativeType === 'character varying') return SQL_VARCHAR_CODEC_ID;
  if (nativeType === 'text') return PG_TEXT_CODEC_ID;

  if (scalarType === 'String') {
    return PG_TEXT_CODEC_ID;
  }

  missingFeatures.add(
    `Column ${tableName}.${columnName} uses native type ${nativeType}, but no matching codec was found. Falling back to pg/text@1.`,
  );
  return PG_TEXT_CODEC_ID;
}

function toLengthTypeParams(args: readonly string[]): Record<string, unknown> | undefined {
  const rawLength = args[0];
  if (!rawLength) return undefined;
  const length = Number.parseInt(rawLength, 10);
  if (Number.isFinite(length)) {
    return { length };
  }
  return undefined;
}

function toPrecisionTypeParams(args: readonly string[]): Record<string, unknown> | undefined {
  const rawPrecision = args[0];
  if (!rawPrecision) return undefined;
  const precision = Number.parseInt(rawPrecision, 10);
  if (Number.isFinite(precision)) {
    return { precision };
  }
  return undefined;
}

function toNumericTypeParams(args: readonly string[]): Record<string, unknown> | undefined {
  const rawPrecision = args[0];
  if (!rawPrecision) return undefined;

  const precision = Number.parseInt(rawPrecision, 10);
  if (!Number.isFinite(precision)) {
    return undefined;
  }

  const rawScale = args[1];
  if (!rawScale) {
    return { precision };
  }

  const scale = Number.parseInt(rawScale, 10);
  if (!Number.isFinite(scale)) {
    return { precision };
  }
  return { precision, scale };
}

function convertDefault(input: {
  readonly field: DmmfField;
  readonly tableName: string;
  readonly columnName: string;
  readonly missingFeatures: Set<string>;
}): DefaultConversionResult {
  const { field, tableName, columnName, missingFeatures } = input;
  if (!field.hasDefaultValue) {
    if (field.isUpdatedAt) {
      missingFeatures.add(
        `@updatedAt on ${tableName}.${columnName} is client-driven and not represented in storage defaults.`,
      );
    }
    return {};
  }

  const value = field.default;
  if (typeof value === 'string') {
    return {
      columnDefault: {
        kind: 'literal',
        expression: quoteSqlLiteral(value),
      },
    };
  }
  if (typeof value === 'number') {
    return {
      columnDefault: {
        kind: 'literal',
        expression: String(value),
      },
    };
  }
  if (typeof value === 'boolean') {
    return {
      columnDefault: {
        kind: 'literal',
        expression: value ? 'true' : 'false',
      },
    };
  }

  if (typeof value !== 'object' || value === null) {
    return {};
  }

  const valueRecord = value as { name?: unknown; args?: unknown };
  const name = typeof valueRecord.name === 'string' ? valueRecord.name : undefined;
  const args = Array.isArray(valueRecord.args) ? valueRecord.args : [];
  if (!name) {
    return {};
  }

  if (name === 'autoincrement') {
    return {
      columnDefault: {
        kind: 'function',
        expression: 'autoincrement()',
      },
    };
  }

  if (name === 'now') {
    return {
      columnDefault: {
        kind: 'function',
        expression: 'now()',
      },
    };
  }

  if (name === 'dbgenerated') {
    const expressionArg = args[0];
    const expression =
      typeof expressionArg === 'string' && expressionArg.trim().length > 0
        ? expressionArg
        : 'dbgenerated()';
    return {
      columnDefault: {
        kind: 'function',
        expression,
      },
    };
  }

  const executionDefault = mapExecutionDefaultGenerator(name, args);
  if (executionDefault) {
    return {
      executionDefault: {
        ref: {
          table: tableName,
          column: columnName,
        },
        onCreate: executionDefault,
      },
    };
  }

  missingFeatures.add(
    `Default function ${name} on ${tableName}.${columnName} is not represented in contract output.`,
  );
  return {};
}

function mapExecutionDefaultGenerator(
  name: string,
  args: readonly unknown[],
): {
  readonly kind: 'generator';
  readonly id: 'ulid' | 'nanoid' | 'uuidv7' | 'uuidv4' | 'cuid2' | 'ksuid';
} | null {
  if (name === 'uuid') {
    const version = typeof args[0] === 'number' ? args[0] : 4;
    return {
      kind: 'generator',
      id: version === 7 ? 'uuidv7' : 'uuidv4',
    };
  }
  if (name === 'nanoid') {
    return {
      kind: 'generator',
      id: 'nanoid',
    };
  }
  if (name === 'ulid') {
    return {
      kind: 'generator',
      id: 'ulid',
    };
  }
  if (name === 'ksuid') {
    return {
      kind: 'generator',
      id: 'ksuid',
    };
  }
  if (name === 'cuid') {
    const version = typeof args[0] === 'number' ? args[0] : 1;
    if (version === 2) {
      return {
        kind: 'generator',
        id: 'cuid2',
      };
    }
  }
  return null;
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}
