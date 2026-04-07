import {
  computeExecutionHash,
  computeProfileHash,
  computeStorageHash,
} from '@prisma-next/contract/hashing';
import {
  type ColumnDefault,
  type ColumnDefaultLiteralInputValue,
  type Contract,
  type ContractField,
  type ContractModel,
  type ContractRelation,
  type ContractValueObject,
  coreHash,
  type ExecutionMutationDefault,
  type ExecutionMutationDefaultValue,
  type JsonValue,
  type StorageHashBase,
} from '@prisma-next/contract/types';
import type {
  ColumnBuilderState,
  ContractBuilderState,
  ModelBuilderState,
  RelationDefinition,
  TableBuilderState,
} from '@prisma-next/contract-authoring';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import {
  applyFkDefaults,
  type SqlStorage,
  type StorageColumn,
  type StorageTable,
  type StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import { validateStorageSemantics } from '@prisma-next/sql-contract/validators';
import { ifDefined } from '@prisma-next/utils/defined';
import type {
  SqlSemanticContractDefinition,
  SqlSemanticFieldNode,
  SqlSemanticModelNode,
  SqlSemanticValueObjectFieldNode,
} from './semantic-contract';

type RuntimeTableState = TableBuilderState<
  string,
  Record<string, ColumnBuilderState<string, boolean, string>>,
  readonly string[] | undefined
>;

type DomainFieldRef =
  | { readonly kind: 'scalar'; readonly many?: boolean }
  | { readonly kind: 'valueObject'; readonly name: string; readonly many?: boolean };

type RuntimeModelState = ModelBuilderState<
  string,
  string,
  Record<string, string>,
  Record<string, RelationDefinition>
> & {
  readonly domainFieldRefs?: Record<string, DomainFieldRef>;
};

export type RuntimeBuilderState = ContractBuilderState<
  string | undefined,
  Record<string, RuntimeTableState>,
  Record<string, RuntimeModelState>,
  string | undefined,
  Record<string, unknown> | undefined,
  Record<string, Record<string, boolean>> | undefined
> & {
  readonly valueObjects?: Record<string, ContractValueObject>;
};

function encodeDefaultLiteralValue(
  value: ColumnDefaultLiteralInputValue,
  codecId: string,
  codecLookup?: CodecLookup,
): JsonValue {
  const codec = codecLookup?.get(codecId);
  if (codec) {
    return codec.encodeJson(value);
  }
  return value as JsonValue;
}

function encodeColumnDefault(
  defaultInput: ColumnDefault,
  codecId: string,
  codecLookup?: CodecLookup,
): ColumnDefault {
  if (defaultInput.kind === 'function') {
    return { kind: 'function', expression: defaultInput.expression };
  }
  return {
    kind: 'literal',
    value: encodeDefaultLiteralValue(defaultInput.value, codecId, codecLookup),
  };
}

function assertStorageSemantics(storage: SqlStorage): void {
  const semanticErrors = validateStorageSemantics(storage);
  if (semanticErrors.length > 0) {
    throw new Error(`Contract semantic validation failed: ${semanticErrors.join('; ')}`);
  }
}

export function buildContract(
  state: RuntimeBuilderState,
  codecLookup?: CodecLookup,
): Contract<SqlStorage> {
  if (!state.target) {
    throw new Error('target is required. Call .target() before .build()');
  }

  const target = state.target;
  const targetFamily = 'sql';

  const storageTables: Record<string, StorageTable> = {};
  const executionDefaults: ExecutionMutationDefault[] = [];

  for (const tableName of Object.keys(state.tables)) {
    const tableState = state.tables[tableName];
    if (!tableState) continue;

    const columns: Record<string, StorageColumn> = {};

    for (const columnName in tableState.columns) {
      const columnState = tableState.columns[columnName];
      if (!columnState) continue;

      const encodedDefault =
        columnState.default !== undefined
          ? encodeColumnDefault(columnState.default as ColumnDefault, columnState.type, codecLookup)
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
  const storageHash: StorageHashBase<string> = state.storageHash
    ? coreHash(state.storageHash)
    : computeStorageHash({
        target,
        targetFamily,
        storage: storageWithoutHash,
      });
  const storage: SqlStorage = { ...storageWithoutHash, storageHash };

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

    const storageFields: Record<string, { readonly column: string }> = {};
    const domainFields: Record<string, ContractField> = {};

    for (const fieldName in modelState.fields) {
      const columnName = modelState.fields[fieldName];
      if (!columnName) continue;

      storageFields[fieldName] = { column: columnName };

      const domainRef = modelState.domainFieldRefs?.[fieldName];
      if (domainRef?.kind === 'valueObject') {
        const columnState = tableState?.columns[columnName];
        domainFields[fieldName] = {
          type: { kind: 'valueObject', name: domainRef.name },
          nullable: columnState?.nullable ?? false,
          ...(domainRef.many ? { many: true } : {}),
        };
      } else {
        const columnState = tableState?.columns[columnName];
        if (columnState) {
          domainFields[fieldName] = {
            type: {
              kind: 'scalar',
              codecId: columnState.type,
              ...ifDefined('typeParams', columnState.typeParams),
            },
            nullable: columnState.nullable ?? false,
            ...(domainRef?.many ? { many: true } : {}),
          };
        }
      }
    }

    // RelationDefinition.cardinality includes 'N:M' which isn't in
    // ContractReferenceRelation yet — cast is needed until the contract
    // type is extended to cover many-to-many.
    const columnToField = new Map(
      Object.entries(modelState.fields).map(([field, col]) => [col, field]),
    );
    const modelRelations: Record<string, ContractRelation> = {};
    if (modelState.relations) {
      for (const relName in modelState.relations) {
        const rel = modelState.relations[relName];
        if (!rel) continue;

        const targetModelState = state.models[rel.to];
        const targetColumnToField = targetModelState
          ? new Map(Object.entries(targetModelState.fields).map(([field, col]) => [col, field]))
          : undefined;

        modelRelations[relName] = {
          to: rel.to,
          cardinality: rel.cardinality as ContractRelation['cardinality'],
          on: {
            localFields: rel.on.parentCols.map((col) => columnToField.get(col) ?? col),
            targetFields: rel.on.childCols.map((col) => targetColumnToField?.get(col) ?? col),
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

  const contract: Contract<SqlStorage> = {
    target,
    targetFamily,
    models,
    roots,
    storage,
    ...(executionWithHash ? { execution: executionWithHash } : {}),
    ...ifDefined('valueObjects', state.valueObjects),
    extensionPacks,
    capabilities,
    profileHash,
    meta: {},
  };

  assertStorageSemantics(contract.storage);

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

function isValueObjectField(
  field: SqlSemanticFieldNode | SqlSemanticValueObjectFieldNode,
): field is SqlSemanticValueObjectFieldNode {
  return 'valueObjectName' in field;
}

const JSONB_CODEC_ID = 'pg/jsonb@1';
const JSONB_NATIVE_TYPE = 'jsonb';

export function buildSqlContractFromSemanticDefinition(
  definition: SqlSemanticContractDefinition,
  codecLookup?: CodecLookup,
): Contract {
  const modelsByName = new Map(definition.models.map((m) => [m.modelName, m]));

  const tables: Record<string, RuntimeTableState> = {};
  for (const model of definition.models) {
    const columns: Record<string, ColumnBuilderState<string, boolean, string>> = {};

    for (const field of model.fields) {
      if (isValueObjectField(field)) {
        columns[field.columnName] = {
          name: field.columnName,
          type: JSONB_CODEC_ID,
          nativeType: JSONB_NATIVE_TYPE,
          nullable: field.nullable,
          ...ifDefined('default', field.default),
          ...ifDefined('executionDefault', field.executionDefault),
        } as ColumnBuilderState<string, boolean, string>;
        continue;
      }

      if (field.many) {
        columns[field.columnName] = {
          name: field.columnName,
          type: JSONB_CODEC_ID,
          nativeType: JSONB_NATIVE_TYPE,
          nullable: field.nullable,
        } as ColumnBuilderState<string, boolean, string>;
        continue;
      }

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
    const domainFieldRefs: Record<string, DomainFieldRef> = {};

    for (const field of model.fields) {
      fields[field.fieldName] = field.columnName;
      if (isValueObjectField(field)) {
        domainFieldRefs[field.fieldName] = {
          kind: 'valueObject',
          name: field.valueObjectName,
          ...(field.many ? { many: true } : {}),
        };
      } else if (field.many) {
        domainFieldRefs[field.fieldName] = {
          kind: 'scalar',
          many: true,
        };
      }
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
      ...(Object.keys(domainFieldRefs).length > 0 ? { domainFieldRefs } : {}),
    };
  }

  const valueObjects: Record<string, ContractValueObject> | undefined =
    definition.valueObjects && definition.valueObjects.length > 0
      ? Object.fromEntries(
          definition.valueObjects.map((vo) => [
            vo.name,
            {
              fields: Object.fromEntries(
                vo.fields.map((f) => [
                  f.fieldName,
                  isValueObjectField(f)
                    ? {
                        type: { kind: 'valueObject' as const, name: f.valueObjectName },
                        nullable: f.nullable,
                        ...(f.many ? { many: true } : {}),
                      }
                    : {
                        type: {
                          kind: 'scalar' as const,
                          codecId: f.descriptor.codecId,
                          ...ifDefined('typeParams', f.descriptor.typeParams),
                        },
                        nullable: f.nullable,
                      },
                ]),
              ),
            },
          ]),
        )
      : undefined;

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
    ...ifDefined('valueObjects', valueObjects),
  };

  return buildContract(state, codecLookup);
}
