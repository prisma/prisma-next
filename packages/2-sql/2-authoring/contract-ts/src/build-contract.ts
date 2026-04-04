import {
  computeExecutionHash,
  computeProfileHash,
  computeStorageHash,
} from '@prisma-next/contract/hashing';
import type {
  ColumnDefault,
  ColumnDefaultLiteralInputValue,
  ColumnDefaultLiteralValue,
  Contract,
  ContractField,
  ContractModel,
  ContractRelation,
  ExecutionMutationDefault,
  ExecutionMutationDefaultValue,
  TaggedRaw,
} from '@prisma-next/contract/types';
import type {
  ColumnBuilderState,
  ContractBuilderState,
  ModelBuilderState,
  RelationDefinition,
  TableBuilderState,
} from '@prisma-next/contract-authoring';
import {
  applyFkDefaults,
  type SqlStorage,
  type StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import { validateStorageSemantics } from '@prisma-next/sql-contract/validators';
import { ifDefined } from '@prisma-next/utils/defined';
import type { SqlSemanticContractDefinition, SqlSemanticModelNode } from './semantic-contract';

type RuntimeTableState = TableBuilderState<
  string,
  Record<string, ColumnBuilderState<string, boolean, string>>,
  readonly string[] | undefined
>;

type RuntimeModelState = ModelBuilderState<
  string,
  string,
  Record<string, string>,
  Record<string, RelationDefinition>
>;

export type RuntimeBuilderState = ContractBuilderState<
  string | undefined,
  Record<string, RuntimeTableState>,
  Record<string, RuntimeModelState>,
  string | undefined,
  Record<string, unknown> | undefined,
  Record<string, Record<string, boolean>> | undefined
>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isJsonValue(value: unknown): value is ColumnDefaultLiteralValue {
  if (value === null) return true;
  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') return true;
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }
  if (isPlainObject(value)) {
    return Object.values(value).every((item) => isJsonValue(item));
  }
  return false;
}

function encodeDefaultLiteralValue(
  value: ColumnDefaultLiteralInputValue,
): ColumnDefaultLiteralValue {
  if (typeof value === 'bigint') {
    return { $type: 'bigint', value: value.toString() };
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (isJsonValue(value)) {
    if (isPlainObject(value) && '$type' in value) {
      return { $type: 'raw', value } satisfies TaggedRaw;
    }
    return value;
  }
  throw new Error(
    'Unsupported column default literal value: expected JSON-safe value, bigint, or Date.',
  );
}

function encodeColumnDefault(defaultInput: ColumnDefault): ColumnDefault {
  if (defaultInput.kind === 'function') {
    return { kind: 'function', expression: defaultInput.expression };
  }
  return { kind: 'literal', value: encodeDefaultLiteralValue(defaultInput.value) };
}

function assertStorageSemantics(storage: SqlStorage): void {
  const semanticErrors = validateStorageSemantics(storage);
  if (semanticErrors.length > 0) {
    throw new Error(`Contract semantic validation failed: ${semanticErrors.join('; ')}`);
  }
}

export function buildContract(state: RuntimeBuilderState): Contract {
  if (!state.target) {
    throw new Error('target is required. Call .target() before .build()');
  }

  const target = state.target;
  const targetFamily = 'sql';

  const storageTables: Record<
    string,
    {
      columns: Record<string, unknown>;
      uniques: unknown[];
      indexes: unknown[];
      foreignKeys: unknown[];
      primaryKey?: unknown;
    }
  > = {};
  const executionDefaults: ExecutionMutationDefault[] = [];

  for (const tableName of Object.keys(state.tables)) {
    const tableState = state.tables[tableName];
    if (!tableState) continue;

    const columns: Record<string, unknown> = {};

    for (const columnName in tableState.columns) {
      const columnState = tableState.columns[columnName];
      if (!columnState) continue;

      const encodedDefault =
        columnState.default !== undefined
          ? encodeColumnDefault(columnState.default as ColumnDefault)
          : undefined;

      columns[columnName] = {
        nativeType: columnState.nativeType,
        codecId: columnState.type,
        nullable: columnState.nullable ?? false,
        ...ifDefined('typeParams', columnState.typeParams),
        ...ifDefined('default', encodedDefault),
        ...ifDefined('typeRef', columnState.typeRef),
      };

      if ('executionDefault' in columnState && columnState.executionDefault) {
        executionDefaults.push({
          ref: { table: tableName, column: columnName },
          onCreate: columnState.executionDefault as ExecutionMutationDefaultValue,
        });
      }
    }

    const uniques = (tableState.uniques ?? []).map((u) => ({
      columns: u.columns,
      ...(u.name ? { name: u.name } : {}),
    }));

    const indexes = (tableState.indexes ?? []).map((i) => ({
      columns: i.columns,
      ...(i.name ? { name: i.name } : {}),
      ...(i.using ? { using: i.using } : {}),
      ...(i.config ? { config: i.config } : {}),
    }));

    const foreignKeys = (tableState.foreignKeys ?? []).map((fk) => ({
      columns: fk.columns,
      references: fk.references,
      ...applyFkDefaults(fk, state.foreignKeyDefaults),
      ...(fk.name ? { name: fk.name } : {}),
      ...(fk.onDelete !== undefined ? { onDelete: fk.onDelete } : {}),
      ...(fk.onUpdate !== undefined ? { onUpdate: fk.onUpdate } : {}),
    }));

    storageTables[tableName] = {
      columns,
      uniques,
      indexes,
      foreignKeys,
      ...(tableState.primaryKey
        ? {
            primaryKey: {
              columns: tableState.primaryKey,
              ...(tableState.primaryKeyName ? { name: tableState.primaryKeyName } : {}),
            },
          }
        : {}),
    };
  }

  const storageTypes = (state.storageTypes ?? {}) as Record<string, StorageTypeInstance>;
  const storageWithoutHash = {
    tables: storageTables,
    types: storageTypes,
  };
  const storageHash = computeStorageHash({
    target,
    targetFamily,
    storage: storageWithoutHash,
  });
  const storage = { ...storageWithoutHash, storageHash };

  const executionSection =
    executionDefaults.length > 0
      ? {
          mutations: {
            defaults: executionDefaults.sort((a, b) => {
              const tableCompare = a.ref.table.localeCompare(b.ref.table);
              if (tableCompare !== 0) {
                return tableCompare;
              }
              return a.ref.column.localeCompare(b.ref.column);
            }),
          },
        }
      : undefined;

  const models: Record<string, ContractModel> = {};
  const roots: Record<string, string> = {};

  for (const modelName in state.models) {
    const modelState = state.models[modelName];
    if (!modelState) continue;

    const tableName = modelState.table;
    roots[tableName] = modelName;

    const tableState = state.tables[tableName];
    const tableColumns = tableState
      ? (tableState.columns as Record<string, { type: string; nullable?: boolean }>)
      : {};

    const storageFields: Record<string, { readonly column: string }> = {};
    const domainFields: Record<string, ContractField> = {};

    for (const fieldName in modelState.fields) {
      const columnName = modelState.fields[fieldName];
      if (!columnName) continue;

      storageFields[fieldName] = { column: columnName };

      const column = tableColumns[columnName];
      if (column) {
        domainFields[fieldName] = {
          codecId: column.type,
          nullable: column.nullable ?? false,
        };
      }
    }

    // RelationDefinition.cardinality includes 'N:M' which isn't in
    // ContractReferenceRelation yet — cast is needed until the contract
    // type is extended to cover many-to-many.
    const modelRelations: Record<string, ContractRelation> = {};
    if (modelState.relations) {
      for (const relName in modelState.relations) {
        const rel = modelState.relations[relName];
        if (!rel) continue;
        modelRelations[relName] = {
          to: rel.to,
          cardinality: rel.cardinality as ContractRelation['cardinality'],
          on: {
            localFields: [...rel.on.parentCols],
            targetFields: [...rel.on.childCols],
          },
        };
      }
    }

    models[modelName] = {
      storage: {
        table: tableName,
        fields: storageFields,
      },
      fields: domainFields,
      relations: modelRelations,
    };
  }

  const extensionNamespaces = state.extensionNamespaces ?? [];
  const extensionPacks: Record<string, unknown> = { ...(state.extensionPacks || {}) };
  for (const namespace of extensionNamespaces) {
    if (!Object.hasOwn(extensionPacks, namespace)) {
      extensionPacks[namespace] = {};
    }
  }

  const capabilities: Record<string, Record<string, boolean>> = state.capabilities || {};
  const profileHash = computeProfileHash({ target, targetFamily, capabilities });

  const executionWithHash = executionSection
    ? {
        ...executionSection,
        executionHash: computeExecutionHash({ target, targetFamily, execution: executionSection }),
      }
    : undefined;

  const contract: Contract = {
    target,
    targetFamily,
    models,
    roots,
    storage,
    ...(executionWithHash ? { execution: executionWithHash } : {}),
    extensionPacks,
    capabilities,
    profileHash,
    meta: {},
  };

  assertStorageSemantics(contract.storage as SqlStorage);

  return contract;
}

function assertKnownTargetModel(
  modelsByName: ReadonlyMap<string, SqlSemanticModelNode>,
  sourceModelName: string,
  targetModelName: string,
  context: string,
): SqlSemanticModelNode {
  const targetModel = modelsByName.get(targetModelName);
  if (!targetModel) {
    throw new Error(
      `${context} on model "${sourceModelName}" references unknown model "${targetModelName}"`,
    );
  }
  return targetModel;
}

function assertTargetTableMatches(
  sourceModelName: string,
  targetModel: SqlSemanticModelNode,
  referencedTableName: string,
  context: string,
): void {
  if (targetModel.tableName !== referencedTableName) {
    throw new Error(
      `${context} on model "${sourceModelName}" references table "${referencedTableName}" but model "${targetModel.modelName}" maps to "${targetModel.tableName}"`,
    );
  }
}

export function buildSqlContractFromSemanticDefinition(
  definition: SqlSemanticContractDefinition,
): Contract {
  const modelsByName = new Map(definition.models.map((m) => [m.modelName, m]));

  const tables: Record<string, RuntimeTableState> = {};
  for (const model of definition.models) {
    const columns: Record<string, ColumnBuilderState<string, boolean, string>> = {};

    for (const field of model.fields) {
      if (field.executionDefault) {
        if (field.default !== undefined) {
          throw new Error(
            `Field "${model.modelName}.${field.fieldName}" cannot define both default and executionDefault.`,
          );
        }
        if (field.nullable) {
          throw new Error(
            `Field "${model.modelName}.${field.fieldName}" cannot be nullable when executionDefault is present.`,
          );
        }
        columns[field.columnName] = {
          name: field.columnName,
          type: field.descriptor.codecId,
          nativeType: field.descriptor.nativeType,
          nullable: false,
          ...ifDefined('typeParams', field.descriptor.typeParams),
          ...ifDefined('typeRef', field.descriptor.typeRef),
          executionDefault: field.executionDefault,
        } as ColumnBuilderState<string, false, string>;
        continue;
      }

      columns[field.columnName] = {
        name: field.columnName,
        type: field.descriptor.codecId,
        nativeType: field.descriptor.nativeType,
        nullable: field.nullable,
        ...ifDefined('typeParams', field.descriptor.typeParams),
        ...ifDefined('typeRef', field.descriptor.typeRef),
        ...ifDefined('default', field.default),
      } as ColumnBuilderState<string, boolean, string>;
    }

    if (model.id) {
      const fieldsByColumnName = new Map(model.fields.map((field) => [field.columnName, field]));
      for (const columnName of model.id.columns) {
        const field = fieldsByColumnName.get(columnName);
        if (field?.nullable) {
          throw new Error(
            `Model "${model.modelName}" uses nullable field "${field.fieldName}" in its identity.`,
          );
        }
      }
    }

    const foreignKeys = (model.foreignKeys ?? []).map((fk) => {
      const targetModel = assertKnownTargetModel(
        modelsByName,
        model.modelName,
        fk.references.model,
        'Foreign key',
      );
      assertTargetTableMatches(model.modelName, targetModel, fk.references.table, 'Foreign key');
      return {
        columns: fk.columns,
        references: { table: fk.references.table, columns: fk.references.columns },
        ...ifDefined('name', fk.name),
        ...ifDefined('onDelete', fk.onDelete),
        ...ifDefined('onUpdate', fk.onUpdate),
        ...ifDefined('constraint', fk.constraint),
        ...ifDefined('index', fk.index),
      };
    });

    tables[model.tableName] = {
      name: model.tableName,
      columns,
      ...(model.id ? { primaryKey: model.id.columns } : {}),
      ...(model.id?.name ? { primaryKeyName: model.id.name } : {}),
      uniques: model.uniques ?? [],
      indexes: model.indexes ?? [],
      foreignKeys,
    } as RuntimeTableState;
  }

  const modelStates: Record<string, RuntimeModelState> = {};
  for (const model of definition.models) {
    const fields: Record<string, string> = {};
    for (const field of model.fields) {
      fields[field.fieldName] = field.columnName;
    }

    const relations: Record<string, RelationDefinition> = {};
    for (const relation of model.relations ?? []) {
      const targetModel = assertKnownTargetModel(
        modelsByName,
        model.modelName,
        relation.toModel,
        'Relation',
      );
      assertTargetTableMatches(model.modelName, targetModel, relation.toTable, 'Relation');

      if (relation.cardinality === 'N:M' && !relation.through) {
        throw new Error(
          `Relation "${model.modelName}.${relation.fieldName}" with cardinality "N:M" requires through metadata`,
        );
      }

      relations[relation.fieldName] = {
        to: relation.toModel,
        cardinality: relation.cardinality,
        on: {
          parentCols: relation.on.parentColumns,
          childCols: relation.on.childColumns,
        },
        ...(relation.through
          ? {
              through: {
                table: relation.through.table,
                parentCols: relation.through.parentColumns,
                childCols: relation.through.childColumns,
              },
            }
          : undefined),
      };
    }

    modelStates[model.modelName] = {
      name: model.modelName,
      table: model.tableName,
      fields,
      relations,
    };
  }

  const extensionNamespaces = definition.extensionPacks
    ? Object.values(definition.extensionPacks).map((pack) => pack.id)
    : undefined;

  const state: RuntimeBuilderState = {
    target: definition.target.targetId,
    tables,
    models: modelStates,
    ...ifDefined('storageTypes', definition.storageTypes),
    ...ifDefined('storageHash', definition.storageHash),
    ...ifDefined('extensionPacks', definition.extensionPacks),
    ...ifDefined('capabilities', definition.capabilities),
    ...ifDefined('foreignKeyDefaults', definition.foreignKeyDefaults),
    ...ifDefined('extensionNamespaces', extensionNamespaces),
  };

  return buildContract(state);
}
