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
  type JsonValue,
  type StorageHashBase,
} from '@prisma-next/contract/types';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import { type Namespace, UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { validateIndexTypes } from '@prisma-next/sql-contract/index-type-validation';
import {
  createIndexTypeRegistry,
  type IndexTypeMap,
  type IndexTypeRegistration,
} from '@prisma-next/sql-contract/index-types';
import {
  applyFkDefaults,
  isPostgresEnumStorageEntry,
  type PostgresEnumStorageEntry,
  SqlStorage,
  SqlUnboundNamespace,
  type StorageColumn,
  type StorageTableInput,
  type StorageTypeInstance,
  toStorageTypeInstance,
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

/**
 * Build the contract's `SqlStorage.namespaces` map.
 *
 * Walks both authored sources of namespace coordinates:
 *
 * - `declared` — the contract's `namespaces: readonly string[]` list
 *   (declared up-front, defensively validated by `defineContract`).
 *   Entries appear in the storage map even if no model references them.
 * - `storageTables[*].namespaceId` — coordinates each model resolves
 *   to. Entries collected from this walk make sure every referenced
 *   slot has a concretion (e.g. for the PSL-authored
 *   `namespace unbound { … }` path, where the only signal is on the
 *   model side).
 *
 * Always includes `UNBOUND_NAMESPACE_ID` so the late-bound slot is
 * available regardless of authoring choices. Skips the empty string
 * and `undefined` to keep the map keys well-defined.
 *
 * Each distinct id is resolved through `createNamespace` (target-
 * supplied). When `createNamespace` is omitted the family layer falls
 * back to its placeholder `SqlUnboundNamespace.instance` singleton for
 * the unbound slot and throws on any non-unbound coordinate — the
 * family alone cannot conjure a target concretion for a named schema.
 */
function buildStorageNamespaces(input: {
  readonly declared: readonly string[] | undefined;
  readonly storageTables: Readonly<Record<string, { readonly namespaceId: string }>>;
  readonly createNamespace: ((id: string) => Namespace) | undefined;
}): Record<string, Namespace> {
  const ids = new Set<string>();
  ids.add(UNBOUND_NAMESPACE_ID);
  if (input.declared) {
    for (const id of input.declared) {
      if (id.length > 0) {
        ids.add(id);
      }
    }
  }
  for (const table of Object.values(input.storageTables)) {
    if (table.namespaceId.length > 0) {
      ids.add(table.namespaceId);
    }
  }

  const factory = input.createNamespace;
  const result: Record<string, Namespace> = {};
  for (const id of ids) {
    if (factory) {
      result[id] = factory(id);
      continue;
    }
    if (id === UNBOUND_NAMESPACE_ID) {
      result[id] = SqlUnboundNamespace.instance;
      continue;
    }
    throw new Error(
      `buildSqlContractFromDefinition: contract declares namespace "${id}" but no \`createNamespace\` factory was supplied — the SQL family layer is target-agnostic and cannot materialise a non-unbound \`Namespace\` concretion on its own. Pass \`createNamespace\` from the target pack (e.g. \`postgresCreateNamespace\` / \`sqliteCreateNamespace\`) through \`defineContract\` to plumb target concretions in.`,
    );
  }
  return result;
}

export function buildSqlContractFromDefinition(
  definition: ContractDefinition,
  codecLookup?: CodecLookup,
): Contract<SqlStorage> {
  const target = definition.target.targetId;
  const targetFamily = 'sql';
  const modelsByName = new Map(definition.models.map((m) => [m.modelName, m]));

  const storageTables: Record<string, StorageTableInput> = {};
  const executionDefaults: ExecutionMutationDefault[] = [];
  const models: Record<string, ContractModel> = {};
  const roots: Record<string, string> = {};

  for (const semanticModel of definition.models) {
    const tableName = semanticModel.tableName;
    roots[tableName] = semanticModel.modelName;

    // Resolve the model's namespace coordinate up-front so it can be
    // stamped on the StorageTable and consulted by FK lowering for
    // same-namespace targets. Omitted = `UNBOUND_NAMESPACE_ID` (the
    // late-bound sentinel); the Postgres default-resolution policy for
    // omitted-but-`public`-aware contracts is a separate concern.
    const sourceNamespaceId: string =
      semanticModel.namespaceId !== undefined ? semanticModel.namespaceId : UNBOUND_NAMESPACE_ID;

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
      // Cross-namespace FKs carry an explicit target namespace; same-namespace
      // FKs inherit the source table's coordinate. The conditional lives at
      // the caller (this lowering site) so the constructed
      // `ForeignKeyReference` always receives a fully-resolved coordinate.
      const targetNamespaceId: string =
        fk.references.namespaceId !== undefined ? fk.references.namespaceId : sourceNamespaceId;
      return {
        source: { columns: fk.columns },
        target: {
          namespaceId: targetNamespaceId,
          table: fk.references.table,
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

    storageTables[tableName] = {
      namespaceId: sourceNamespaceId,
      columns,
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
  const namespaces = buildStorageNamespaces({
    declared: definition.namespaces,
    storageTables,
    createNamespace: definition.createNamespace,
  });
  const storageWithoutHash = {
    tables: storageTables,
    // Only thread `types` through when at least one entry exists.
    // `SqlStorage`'s `toJSON` projection emits `types` enumerably
    // whenever the slot is constructed (even with an empty record),
    // and the canonicaliser preserves the resulting `types: {}`
    // wrapper. Pinning the same emptiness convention end-to-end keeps
    // the storage hash recomputed by `assertDescriptorSelfConsistency`
    // identical to the value `build-contract` pinned.
    ...(Object.keys(storageTypes).length > 0 ? { types: storageTypes } : {}),
    namespaces,
  };
  // The persisted contract envelope carries the FR15 nested-by-namespace
  // shape (via `SqlStorage.toJSON`); the storage hash has to be computed
  // against that same canonical form so the recomputed hash inside
  // `assertDescriptorSelfConsistency` agrees with the value the emit
  // pipeline pinned. Project through `JSON.parse(JSON.stringify(...))`
  // — constructing `SqlStorage` first so `toJSON` runs over a hydrated
  // IR — then strip the placeholder hash before recomputing.
  const projectedStorage = JSON.parse(
    JSON.stringify(
      new SqlStorage({ ...storageWithoutHash, storageHash: 'sha256:0' as StorageHashBase<string> }),
    ),
  ) as Record<string, unknown>;
  const { storageHash: _placeholder, ...storageForHash } = projectedStorage;
  const storageHash: StorageHashBase<string> = definition.storageHash
    ? coreHash(definition.storageHash)
    : computeStorageHash({ target, targetFamily, storage: storageForHash });
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

  assertStorageSemantics(definition, contract);

  return contract;
}
