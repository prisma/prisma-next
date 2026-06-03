import {
  computeExecutionHash,
  computeProfileHash,
  computeStorageHash,
} from '@prisma-next/contract/hashing';
import {
  asNamespaceId,
  type ColumnDefault,
  type ColumnDefaultLiteralInputValue,
  type Contract,
  type ContractField,
  type ContractModel,
  type ContractRelation,
  type ContractValueObject,
  type CrossReference,
  coreHash,
  crossRef,
  type ExecutionMutationDefault,
  type JsonValue,
  type StorageHashBase,
} from '@prisma-next/contract/types';
import { type CapabilityMatrix, mergeCapabilityMatrices } from '@prisma-next/contract-authoring';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import { sqlContractCanonicalizationHooks } from '@prisma-next/sql-contract/canonicalization-hooks';
import { validateIndexTypes } from '@prisma-next/sql-contract/index-type-validation';
import {
  createIndexTypeRegistry,
  type IndexTypeMap,
  type IndexTypeRegistration,
} from '@prisma-next/sql-contract/index-types';
import {
  applyFkDefaults,
  buildSqlNamespace,
  isPostgresEnumStorageEntry,
  type PostgresEnumStorageEntry,
  type SqlNamespaceTablesInput,
  SqlStorage,
  type SqlStorageInput,
  type StorageColumn,
  StorageTable,
  type StorageTableInput,
  type StorageTypeInstance,
  toStorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import { validateStorageSemantics } from '@prisma-next/sql-contract/validators';
import { blindCast } from '@prisma-next/utils/casts';
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

function assertStorageSemantics(
  definition: ContractDefinition,
  contract: Contract<SqlStorage>,
): void {
  const semanticErrors = validateStorageSemantics(contract.storage);
  if (semanticErrors.length > 0) {
    throw new Error(`Contract semantic validation failed: ${semanticErrors.join('; ')}`);
  }

  const indexTypeRegistry = createIndexTypeRegistry();
  const packsToRegister: ReadonlyArray<{ readonly id?: string; readonly indexTypes?: unknown }> = [
    definition.target,
    ...Object.values(definition.extensionPacks ?? {}),
  ];
  for (const pack of packsToRegister) {
    const registration = pack.indexTypes;
    if (registration === undefined) continue;
    if (
      typeof registration !== 'object' ||
      registration === null ||
      !Array.isArray((registration as { entries?: unknown }).entries)
    ) {
      throw new Error(
        `Pack "${pack.id ?? '<unknown>'}" declares "indexTypes" but its value is not an IndexTypeRegistration (expected an object with an "entries" array; got ${typeof registration}).`,
      );
    }
    for (const entry of (registration as IndexTypeRegistration<IndexTypeMap>).entries) {
      indexTypeRegistry.register(entry);
    }
  }
  validateIndexTypes(contract, indexTypeRegistry);
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

function resolveModelNamespaceId(
  model: ModelNode,
  modelNameToNamespaceId: ReadonlyMap<string, string>,
  defaultNamespaceId: string,
): string {
  if (model.namespaceId !== undefined && model.namespaceId.length > 0) {
    return model.namespaceId;
  }
  return modelNameToNamespaceId.get(model.modelName) ?? defaultNamespaceId;
}

function buildStorageColumn(
  field: FieldNode | ValueObjectFieldNode,
  codecLookup?: CodecLookup,
): StorageColumn {
  if (isValueObjectField(field)) {
    const encodedDefault =
      field.default !== undefined
        ? encodeColumnDefault(field.default, JSONB_CODEC_ID, codecLookup)
        : undefined;

    return {
      nativeType: JSONB_NATIVE_TYPE,
      codecId: JSONB_CODEC_ID,
      nullable: field.nullable,
      ...ifDefined('default', encodedDefault),
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

function collectStorageNamespaceCoordinateIds(definition: ContractDefinition): Set<string> {
  const ids = new Set<string>();
  ids.add(definition.target.defaultNamespaceId);
  for (const id of definition.namespaces ?? []) {
    if (id.length > 0) {
      ids.add(id);
    }
  }
  for (const model of definition.models) {
    if (model.namespaceId !== undefined && model.namespaceId.length > 0) {
      ids.add(model.namespaceId);
    }
  }
  return ids;
}

const POSTGRES_ENUM_NAMESPACE_ID = 'public';

function partitionStorageTypesForTarget(
  targetId: string,
  types: Record<string, StorageTypeInstance | PostgresEnumStorageEntry>,
  namespaceTypes?: Readonly<Record<string, Readonly<Record<string, PostgresEnumStorageEntry>>>>,
): {
  readonly documentTypes: Record<string, StorageTypeInstance | PostgresEnumStorageEntry>;
  readonly namespaceEnumTypesById: Record<string, Record<string, PostgresEnumStorageEntry>>;
} {
  const documentTypes: Record<string, StorageTypeInstance | PostgresEnumStorageEntry> = {};
  const namespaceEnumTypesById: Record<string, Record<string, PostgresEnumStorageEntry>> = {};
  for (const [name, entry] of Object.entries(types)) {
    if (isPostgresEnumStorageEntry(entry)) {
      if (targetId !== 'postgres') {
        throw new Error(
          `buildSqlContractFromDefinition: postgres enum "${name}" is only valid when target is "postgres" (got "${targetId}").`,
        );
      }
      let slot = namespaceEnumTypesById[POSTGRES_ENUM_NAMESPACE_ID];
      if (slot === undefined) {
        slot = {};
        namespaceEnumTypesById[POSTGRES_ENUM_NAMESPACE_ID] = slot;
      }
      slot[name] = entry;
      continue;
    }
    documentTypes[name] = entry;
  }
  if (namespaceTypes !== undefined) {
    for (const [nsId, enumsInNs] of Object.entries(namespaceTypes)) {
      for (const [name, entry] of Object.entries(enumsInNs)) {
        if (targetId !== 'postgres') {
          throw new Error(
            `buildSqlContractFromDefinition: postgres enum "${name}" is only valid when target is "postgres" (got "${targetId}").`,
          );
        }
        let slot = namespaceEnumTypesById[nsId];
        if (slot === undefined) {
          slot = {};
          namespaceEnumTypesById[nsId] = slot;
        }
        slot[name] = entry;
      }
    }
  }
  return { documentTypes, namespaceEnumTypesById };
}

export function buildSqlContractFromDefinition(
  definition: ContractDefinition,
  codecLookup?: CodecLookup,
): Contract<SqlStorage> {
  const target = definition.target.targetId;
  const defaultNamespaceId = definition.target.defaultNamespaceId;
  const targetFamily = 'sql';
  const modelsByName = new Map(definition.models.map((m) => [m.modelName, m]));

  const tablesByNamespace: Record<string, Record<string, StorageTable>> = {};
  const tableNameToNamespaceId = new Map<string, string>();
  const modelNameToNamespaceId = new Map<string, string>();
  const executionDefaults: ExecutionMutationDefault[] = [];
  const modelsByNamespace: Record<string, Record<string, ContractModel>> = {};
  const roots: Record<string, CrossReference> = {};

  for (const semanticModel of definition.models) {
    const tableName = semanticModel.tableName;
    const namespaceId =
      semanticModel.namespaceId !== undefined && semanticModel.namespaceId.length > 0
        ? semanticModel.namespaceId
        : defaultNamespaceId;
    modelNameToNamespaceId.set(semanticModel.modelName, namespaceId);
    roots[tableName] = crossRef(semanticModel.modelName, namespaceId);

    // --- Build storage table ---

    const columns: Record<string, StorageColumn> = {};
    const fieldToColumn: Record<string, string> = {};
    const domainFields: Record<string, ContractField> = {};
    const domainFieldRefs: Record<string, DomainFieldRef> = {};

    for (const field of semanticModel.fields) {
      const executionDefaultPhases =
        field.executionDefaults?.onCreate || field.executionDefaults?.onUpdate
          ? field.executionDefaults
          : undefined;
      if (executionDefaultPhases) {
        if (field.default !== undefined) {
          throw new Error(
            `Field "${semanticModel.modelName}.${field.fieldName}" cannot define both default and executionDefaults.`,
          );
        }
        if (field.nullable) {
          throw new Error(
            `Field "${semanticModel.modelName}.${field.fieldName}" cannot be nullable when executionDefaults are present.`,
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

      if (executionDefaultPhases) {
        executionDefaults.push({
          ref: { table: tableName, column: field.columnName },
          ...ifDefined('onCreate', executionDefaultPhases.onCreate),
          ...ifDefined('onUpdate', executionDefaultPhases.onUpdate),
        });
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
      const targetNamespaceId =
        fk.references.namespaceId ??
        (targetModel.namespaceId !== undefined && targetModel.namespaceId.length > 0
          ? targetModel.namespaceId
          : defaultNamespaceId);
      return {
        source: { namespaceId: asNamespaceId(namespaceId), tableName, columns: fk.columns },
        target: {
          namespaceId: asNamespaceId(targetNamespaceId),
          tableName: fk.references.table,
          columns: fk.references.columns,
        },
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

    const existingNs = tableNameToNamespaceId.get(tableName);
    if (existingNs !== undefined && existingNs !== namespaceId) {
      throw new Error(
        `buildSqlContractFromDefinition: table "${tableName}" is mapped in namespace "${namespaceId}" but already exists in namespace "${existingNs}".`,
      );
    }
    tableNameToNamespaceId.set(tableName, namespaceId);

    const tableInput: StorageTableInput = {
      columns,
      ...ifDefined('control', semanticModel.control),
      uniques: (semanticModel.uniques ?? []).map((u) => ({
        columns: u.columns,
        ...ifDefined('name', u.name),
      })),
      indexes: (semanticModel.indexes ?? []).map((i) => ({
        columns: i.columns,
        ...ifDefined('name', i.name),
        ...ifDefined('type', i.type),
        ...ifDefined('options', i.options),
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

    let nsTables = tablesByNamespace[namespaceId];
    if (nsTables === undefined) {
      nsTables = {};
      tablesByNamespace[namespaceId] = nsTables;
    }
    if (nsTables[tableName] !== undefined) {
      throw new Error(
        `buildSqlContractFromDefinition: duplicate table "${tableName}" in namespace "${namespaceId}".`,
      );
    }
    nsTables[tableName] = new StorageTable(tableInput);

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
        to: crossRef(
          relation.toModel,
          resolveModelNamespaceId(targetModel, modelNameToNamespaceId, defaultNamespaceId),
        ),
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

    let namespaceModels = modelsByNamespace[namespaceId];
    if (namespaceModels === undefined) {
      namespaceModels = {};
      modelsByNamespace[namespaceId] = namespaceModels;
    }
    namespaceModels[semanticModel.modelName] = {
      storage: {
        table: tableName,
        namespaceId,
        fields: storageFields,
      },
      fields: domainFields,
      relations: modelRelations,
    };
  }

  // --- Assemble contract ---

  // Normalise raw codec-triple inputs to the `kind: 'codec-instance'`
  // discriminator shape before hashing so the storageHash matches the
  // persisted JSON envelope produced from the SqlStorage class instance
  // (which always carries the discriminator).
  const rawStorageTypes = (definition.storageTypes ?? {}) as Record<
    string,
    StorageTypeInstance | PostgresEnumStorageEntry
  >;
  const storageTypes = Object.fromEntries(
    Object.entries(rawStorageTypes).map(([name, entry]) => {
      if (isPostgresEnumStorageEntry(entry)) return [name, entry];
      if ((entry as { kind?: unknown }).kind === 'codec-instance') return [name, entry];
      return [
        name,
        toStorageTypeInstance({
          codecId: entry.codecId,
          nativeType: entry.nativeType,
          typeParams: (entry as { typeParams?: Record<string, unknown> }).typeParams ?? {},
        }),
      ];
    }),
  );
  const { documentTypes, namespaceEnumTypesById } = partitionStorageTypesForTarget(
    target,
    storageTypes,
    definition.namespaceTypes,
  );
  const namespaceCoordinateIds = collectStorageNamespaceCoordinateIds(definition);
  for (const id of Object.keys(namespaceEnumTypesById)) {
    namespaceCoordinateIds.add(id);
  }
  const { createNamespace } = definition;
  const namespaces = blindCast<
    SqlStorageInput['namespaces'],
    'contract authoring materialises each namespace coordinate from the model set and explicit namespace list'
  >(
    Object.fromEntries(
      [...namespaceCoordinateIds].sort().map((id) => {
        const enumTypes = namespaceEnumTypesById[id];
        const nsInput: SqlNamespaceTablesInput = {
          id,
          tables: tablesByNamespace[id] ?? {},
          ...ifDefined('enum', enumTypes),
        };
        return [id, createNamespace ? createNamespace(nsInput) : buildSqlNamespace(nsInput)];
      }),
    ),
  );
  const storageWithoutHash = {
    ...(Object.keys(documentTypes).length > 0 ? { types: documentTypes } : {}),
    namespaces,
  };
  const storageHash: StorageHashBase<string> = definition.storageHash
    ? coreHash(definition.storageHash)
    : computeStorageHash({
        target,
        targetFamily,
        storage: storageWithoutHash as Record<string, unknown>,
        ...sqlContractCanonicalizationHooks,
      });
  const storage = new SqlStorage({ ...storageWithoutHash, storageHash });

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

  const extensionPackCapabilitySources = definition.extensionPacks
    ? Object.values(definition.extensionPacks).map(
        (pack) => pack.capabilities as CapabilityMatrix | undefined,
      )
    : [];
  const capabilities = mergeCapabilityMatrices(
    definition.target.capabilities as CapabilityMatrix | undefined,
    ...extensionPackCapabilitySources,
  );
  // Internal `profileHash` computation is unchanged from `origin/main`: it
  // continues to fingerprint the author-declared capability subset. With
  // `capabilities` removed from the `defineContract` input that subset is
  // now always empty, so the hash naturally stabilises at `hash({})`.
  const profileHash = computeProfileHash({
    target,
    targetFamily,
    capabilities: {},
  });

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

  const domainNamespaceIds = new Set(Object.keys(modelsByNamespace));
  if (domainNamespaceIds.size === 0) {
    domainNamespaceIds.add(defaultNamespaceId);
  }
  if (valueObjects !== undefined) {
    domainNamespaceIds.add(defaultNamespaceId);
  }
  const domainNamespaces = Object.fromEntries(
    [...domainNamespaceIds].sort().map((namespaceId) => {
      const modelsInNs = modelsByNamespace[namespaceId] ?? {};
      const namespaceSlice =
        namespaceId === defaultNamespaceId && valueObjects !== undefined
          ? { models: modelsInNs, valueObjects }
          : { models: modelsInNs };
      return [namespaceId, namespaceSlice];
    }),
  );

  const contract: Contract<SqlStorage> = {
    target,
    targetFamily,
    ...ifDefined('defaultControlPolicy', definition.defaultControlPolicy),
    domain: { namespaces: domainNamespaces },
    roots,
    storage,
    ...(executionWithHash ? { execution: executionWithHash } : {}),
    extensionPacks,
    capabilities,
    profileHash,
    meta: {},
  };

  assertStorageSemantics(definition, contract);

  return contract;
}
