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
  ContractDefinition,
  FieldNode,
  ModelNode,
  ValueObjectFieldNode,
} from './contract-definition';

type DomainFieldRef =
  | { readonly kind: 'scalar'; readonly many?: boolean }
  | { readonly kind: 'valueObject'; readonly name: string; readonly many?: boolean };

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

function assertKnownTargetModel(
  modelsByName: ReadonlyMap<string, ModelNode>,
  sourceModelName: string,
  targetModelName: string,
  context: string,
): ModelNode {
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
  targetModel: ModelNode,
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
  field: FieldNode | ValueObjectFieldNode,
): field is ValueObjectFieldNode {
  return 'valueObjectName' in field;
}

const JSONB_CODEC_ID = 'pg/jsonb@1';
const JSONB_NATIVE_TYPE = 'jsonb';

function buildStorageColumn(
  field: FieldNode | ValueObjectFieldNode,
  codecLookup?: CodecLookup,
): StorageColumn {
  if (isValueObjectField(field)) {
    return {
      nativeType: JSONB_NATIVE_TYPE,
      codecId: JSONB_CODEC_ID,
      nullable: field.nullable,
      ...ifDefined('default', field.default),
    };
  }

  if (field.many) {
    return {
      nativeType: JSONB_NATIVE_TYPE,
      codecId: JSONB_CODEC_ID,
      nullable: field.nullable,
    };
  }

  const codecId = field.descriptor.codecId;
  const encodedDefault =
    field.default !== undefined
      ? encodeColumnDefault(field.default, codecId, codecLookup)
      : undefined;

  return {
    nativeType: field.descriptor.nativeType,
    codecId,
    nullable: field.nullable,
    ...ifDefined('typeParams', field.descriptor.typeParams),
    ...ifDefined('default', encodedDefault),
    ...ifDefined('typeRef', field.descriptor.typeRef),
  };
}

function buildDomainField(
  field: FieldNode | ValueObjectFieldNode,
  column: StorageColumn,
): ContractField {
  if (isValueObjectField(field)) {
    return {
      type: { kind: 'valueObject', name: field.valueObjectName },
      nullable: field.nullable,
      ...(field.many ? { many: true } : {}),
    };
  }

  return {
    type: {
      kind: 'scalar',
      codecId: column.codecId,
      ...ifDefined('typeParams', column.typeParams),
    },
    nullable: column.nullable,
    ...(field.many ? { many: true } : {}),
  };
}

export function buildSqlContractFromDefinition(
  definition: ContractDefinition,
  codecLookup?: CodecLookup,
): Contract<SqlStorage> {
  const target = definition.target.targetId;
  const targetFamily = 'sql';
  const modelsByName = new Map(definition.models.map((m) => [m.modelName, m]));

  const storageTables: Record<string, StorageTable> = {};
  const executionDefaults: ExecutionMutationDefault[] = [];
  const models: Record<string, ContractModel> = {};
  const roots: Record<string, string> = {};

  for (const semanticModel of definition.models) {
    const tableName = semanticModel.tableName;
    roots[tableName] = semanticModel.modelName;

    // --- Build storage table ---

    const columns: Record<string, StorageColumn> = {};
    const fieldToColumn: Record<string, string> = {};
    const domainFields: Record<string, ContractField> = {};
    const domainFieldRefs: Record<string, DomainFieldRef> = {};

    for (const field of semanticModel.fields) {
      if (field.executionDefault) {
        if (field.default !== undefined) {
          throw new Error(
            `Field "${semanticModel.modelName}.${field.fieldName}" cannot define both default and executionDefault.`,
          );
        }
        if (field.nullable) {
          throw new Error(
            `Field "${semanticModel.modelName}.${field.fieldName}" cannot be nullable when executionDefault is present.`,
          );
        }
      }

      const column = buildStorageColumn(field, codecLookup);
      columns[field.columnName] = column;
      fieldToColumn[field.fieldName] = field.columnName;

      domainFields[field.fieldName] = buildDomainField(field, column);

      if (isValueObjectField(field)) {
        domainFieldRefs[field.fieldName] = {
          kind: 'valueObject',
          name: field.valueObjectName,
          ...(field.many ? { many: true } : {}),
        };
      } else if (field.many) {
        domainFieldRefs[field.fieldName] = { kind: 'scalar', many: true };
      }

      if ('executionDefault' in field && field.executionDefault) {
        executionDefaults.push({
          ref: { table: tableName, column: field.columnName },
          onCreate: field.executionDefault as ExecutionMutationDefaultValue,
        });
      }
    }

    if (semanticModel.id) {
      const fieldsByColumnName = new Map(
        semanticModel.fields.map((field) => [field.columnName, field]),
      );
      for (const columnName of semanticModel.id.columns) {
        const field = fieldsByColumnName.get(columnName);
        if (field?.nullable) {
          throw new Error(
            `Model "${semanticModel.modelName}" uses nullable field "${field.fieldName}" in its identity.`,
          );
        }
      }
    }

    const foreignKeys = (semanticModel.foreignKeys ?? []).map((fk) => {
      const targetModel = assertKnownTargetModel(
        modelsByName,
        semanticModel.modelName,
        fk.references.model,
        'Foreign key',
      );
      assertTargetTableMatches(
        semanticModel.modelName,
        targetModel,
        fk.references.table,
        'Foreign key',
      );
      return {
        columns: fk.columns,
        references: { table: fk.references.table, columns: fk.references.columns },
        ...applyFkDefaults(
          {
            ...ifDefined('constraint', fk.constraint),
            ...ifDefined('index', fk.index),
          },
          definition.foreignKeyDefaults,
        ),
        ...ifDefined('name', fk.name),
        ...ifDefined('onDelete', fk.onDelete),
        ...ifDefined('onUpdate', fk.onUpdate),
      };
    });

    storageTables[tableName] = {
      columns,
      uniques: (semanticModel.uniques ?? []).map((u) => ({
        columns: u.columns,
        ...ifDefined('name', u.name),
      })),
      indexes: (semanticModel.indexes ?? []).map((i) => ({
        columns: i.columns,
        ...ifDefined('name', i.name),
        ...ifDefined('using', i.using),
        ...ifDefined('config', i.config),
      })),
      foreignKeys,
      ...(semanticModel.id
        ? {
            primaryKey: {
              columns: semanticModel.id.columns,
              ...ifDefined('name', semanticModel.id.name),
            },
          }
        : {}),
    };

    // --- Build contract model ---

    const storageFields: Record<string, { readonly column: string }> = {};
    for (const [fieldName, columnName] of Object.entries(fieldToColumn)) {
      storageFields[fieldName] = { column: columnName };
    }

    const columnToField = new Map(
      Object.entries(fieldToColumn).map(([field, col]) => [col, field]),
    );
    const modelRelations: Record<string, ContractRelation> = {};
    for (const relation of semanticModel.relations ?? []) {
      const targetModel = assertKnownTargetModel(
        modelsByName,
        semanticModel.modelName,
        relation.toModel,
        'Relation',
      );
      assertTargetTableMatches(semanticModel.modelName, targetModel, relation.toTable, 'Relation');

      if (relation.cardinality === 'N:M' && !relation.through) {
        throw new Error(
          `Relation "${semanticModel.modelName}.${relation.fieldName}" with cardinality "N:M" requires through metadata`,
        );
      }

      const targetColumnToField = new Map(
        targetModel.fields.map((f) => [f.columnName, f.fieldName]),
      );

      modelRelations[relation.fieldName] = {
        to: relation.toModel,
        // RelationDefinition.cardinality includes 'N:M' which isn't in
        // ContractReferenceRelation yet — cast is needed until the contract
        // type is extended to cover many-to-many.
        cardinality: relation.cardinality as ContractRelation['cardinality'],
        on: {
          localFields: relation.on.parentColumns.map((col) => columnToField.get(col) ?? col),
          targetFields: relation.on.childColumns.map((col) => targetColumnToField.get(col) ?? col),
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

    models[semanticModel.modelName] = {
      storage: {
        table: tableName,
        fields: storageFields,
      },
      fields: domainFields,
      relations: modelRelations,
    };
  }

  // --- Assemble contract ---

  const storageTypes = (definition.storageTypes ?? {}) as Record<string, StorageTypeInstance>;
  const storageWithoutHash = {
    tables: storageTables,
    types: storageTypes,
  };
  const storageHash: StorageHashBase<string> = definition.storageHash
    ? coreHash(definition.storageHash)
    : computeStorageHash({ target, targetFamily, storage: storageWithoutHash });
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

  const extensionNamespaces = definition.extensionPacks
    ? Object.values(definition.extensionPacks).map((pack) => pack.id)
    : undefined;

  const extensionPacks: Record<string, unknown> = { ...(definition.extensionPacks || {}) };
  if (extensionNamespaces) {
    for (const namespace of extensionNamespaces) {
      if (!Object.hasOwn(extensionPacks, namespace)) {
        extensionPacks[namespace] = {};
      }
    }
  }

  const capabilities: Record<string, Record<string, boolean>> = definition.capabilities || {};
  const profileHash = computeProfileHash({ target, targetFamily, capabilities });

  const executionWithHash = executionSection
    ? {
        ...executionSection,
        executionHash: computeExecutionHash({ target, targetFamily, execution: executionSection }),
      }
    : undefined;

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

  const contract: Contract<SqlStorage> = {
    target,
    targetFamily,
    models,
    roots,
    storage,
    ...(executionWithHash ? { execution: executionWithHash } : {}),
    ...ifDefined('valueObjects', valueObjects),
    extensionPacks,
    capabilities,
    profileHash,
    meta: {},
  };

  assertStorageSemantics(contract.storage);

  return contract;
}
