import {
  computeExecutionHash,
  computeProfileHash,
  computeStorageHash,
} from '@prisma-next/contract/hashing';
import {
  asNamespaceId,
  type ColumnDefault,
  type Contract,
  type ContractEnum,
  type ContractField,
  type ContractModel,
  type ContractRelation,
  type ContractRelationThrough,
  type ContractValueObject,
  type CrossReference,
  coreHash,
  crossRef,
  type ExecutionMutationDefault,
  type JsonValue,
  type StorageHashBase,
  type ValueSetRef,
} from '@prisma-next/contract/types';
import { type CapabilityMatrix, mergeCapabilityMatrices } from '@prisma-next/contract-authoring';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { sqlContractCanonicalizationHooks } from '@prisma-next/sql-contract/canonicalization-hooks';
import { validateIndexTypes } from '@prisma-next/sql-contract/index-type-validation';
import {
  createIndexTypeRegistry,
  type IndexTypeMap,
  type IndexTypeRegistration,
} from '@prisma-next/sql-contract/index-types';
import {
  applyFkDefaults,
  type CheckConstraintInput,
  type SqlNamespaceInput,
  SqlStorage,
  type SqlStorageInput,
  type StorageColumn,
  type StorageTableInput,
  type StorageTypeInstance,
  type StorageValueSetInput,
  toStorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import { validateStorageSemantics } from '@prisma-next/sql-contract/validators';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import type {
  ContractDefinition,
  FieldNode,
  ModelNode,
  RelationNode,
  ValueObjectFieldNode,
} from './contract-definition';

type DomainFieldRef =
  | { readonly kind: 'scalar'; readonly many?: boolean }
  | { readonly kind: 'valueObject'; readonly name: string; readonly many?: boolean };

function encodeViaCodec(value: unknown, codecId: string, codecLookup?: CodecLookup): JsonValue {
  const codec = codecLookup?.get(codecId);
  if (codec) {
    return codec.encodeJson(value);
  }
  return blindCast<
    JsonValue,
    'no codec lookup at build time: literal/enum member value is already JSON-safe'
  >(value);
}

function encodeColumnDefault(
  defaultInput: ColumnDefault,
  codecId: string,
  codecLookup?: CodecLookup,
  many = false,
): ColumnDefault {
  if (defaultInput.kind === 'function') {
    return { kind: 'function', expression: defaultInput.expression };
  }
  if (many) {
    if (!Array.isArray(defaultInput.value)) {
      throw new Error(
        `Literal default on a list column must be an array; received ${typeof defaultInput.value}. ` +
          'A scalar default on a list field must be rejected at the authoring surface.',
      );
    }
    return {
      kind: 'literal',
      value: defaultInput.value.map((element) => encodeViaCodec(element, codecId, codecLookup)),
    };
  }
  return {
    kind: 'literal',
    value: encodeViaCodec(defaultInput.value, codecId, codecLookup),
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
  modelsByCoordinate: ReadonlyMap<string, ModelNode>,
  sourceModelName: string,
  targetModelName: string,
  targetNamespaceId: string | undefined,
  context: string,
): ModelNode {
  const targetModel =
    targetNamespaceId !== undefined && targetNamespaceId.length > 0
      ? modelsByCoordinate.get(`${targetNamespaceId}:${targetModelName}`)
      : modelsByName.get(targetModelName);
  if (!targetModel) {
    const qualified =
      targetNamespaceId !== undefined && targetNamespaceId.length > 0
        ? `${targetNamespaceId}.${targetModelName}`
        : targetModelName;
    throw new Error(
      `${context} on model "${sourceModelName}" references unknown model "${qualified}"`,
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

function buildThroughDescriptor(
  through: NonNullable<RelationNode['through']>,
  tableNamespaceByName: ReadonlyMap<string, string>,
  targetModel: ModelNode,
  modelName: string,
  fieldName: string,
  defaultNamespaceId: string,
): ContractRelationThrough {
  if (!tableNamespaceByName.has(through.table)) {
    throw new Error(
      `buildSqlContractFromDefinition: junction table "${through.table}" for relation "${modelName}.${fieldName}" is not a declared model.`,
    );
  }
  // Junction table names are unique per namespace, not globally. Prefer the
  // junction's own declared namespace (carried on the through node); fall back to
  // the target's default namespace. Resolving by bare table name would pick the
  // wrong namespace when the same junction table name exists in two namespaces.
  const namespaceId = through.namespaceId ?? defaultNamespaceId;

  return {
    table: through.table,
    namespaceId,
    parentColumns: through.parentColumns,
    childColumns: through.childColumns,
    targetColumns: targetColumnsForJunction(targetModel, fieldName),
  };
}

function targetColumnsForJunction(targetModel: ModelNode, fieldName: string): readonly string[] {
  const primaryKeyColumns = targetModel.id?.columns;
  if (primaryKeyColumns && primaryKeyColumns.length > 0) {
    return primaryKeyColumns;
  }
  const firstUnique = targetModel.uniques?.find((u) => u.columns.length > 0);
  if (firstUnique) {
    return firstUnique.columns;
  }
  throw new Error(
    `M:N target model "${targetModel.modelName}" (relation field "${fieldName}") has no primary id or unique key to derive junction targetColumns.`,
  );
}

function buildStorageColumn(
  field: FieldNode | ValueObjectFieldNode,
  storageValueSetRef: ValueSetRef | undefined,
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

  const codecId = field.descriptor.codecId;
  const encodedDefault =
    field.default !== undefined
      ? encodeColumnDefault(field.default, codecId, codecLookup, field.many === true)
      : undefined;

  // `storageValueSetRef` (derived from an `enumTypeHandle`) takes precedence
  // when present — the established domain-enum path. `field.descriptor.valueSet`
  // is the fallback: set by an entity-ref type constructor (e.g. `pg.enum(Ref)`)
  // that resolved the field's type against a value-set-deriving entity with no
  // domain enum involved. A field carries at most one of the two in practice.
  const valueSet = storageValueSetRef ?? field.descriptor.valueSet;

  return {
    nativeType: field.descriptor.nativeType,
    codecId,
    nullable: field.nullable,
    ...(field.many ? { many: true as const } : {}),
    ...ifDefined('typeParams', field.descriptor.typeParams),
    ...ifDefined('default', encodedDefault),
    ...ifDefined('typeRef', field.descriptor.typeRef),
    ...ifDefined('valueSet', valueSet),
  };
}

function buildDomainField(
  field: FieldNode | ValueObjectFieldNode,
  column: StorageColumn,
  domainValueSetRef: ValueSetRef | undefined,
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
    ...ifDefined('valueSet', domainValueSetRef),
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

function ensureUnboundNamespaceSlot(
  namespaces: SqlStorageInput['namespaces'],
  createNamespace: ContractDefinition['createNamespace'],
): SqlStorageInput['namespaces'] {
  if (Object.hasOwn(namespaces, UNBOUND_NAMESPACE_ID)) {
    return namespaces;
  }
  const unboundInput: SqlNamespaceInput = {
    id: UNBOUND_NAMESPACE_ID,
    entries: { table: {} },
  };
  const unbound = createNamespace(unboundInput);
  return {
    [UNBOUND_NAMESPACE_ID]: unbound,
    ...namespaces,
  };
}

export function buildSqlContractFromDefinition(
  definition: ContractDefinition,
  codecLookup?: CodecLookup,
): Contract<SqlStorage> {
  const target = definition.target.targetId;
  const defaultNamespaceId = definition.target.defaultNamespaceId;
  const targetFamily = 'sql';
  const resolveNamespaceId = (m: ModelNode): string =>
    m.namespaceId !== undefined && m.namespaceId.length > 0 ? m.namespaceId : defaultNamespaceId;
  const modelsByName = new Map(definition.models.map((m) => [m.modelName, m]));
  const tableNamespaceByName = new Map(
    definition.models.map((m) => [
      m.tableName,
      m.namespaceId !== undefined && m.namespaceId.length > 0 ? m.namespaceId : defaultNamespaceId,
    ]),
  );
  const modelsByCoordinate = new Map(
    definition.models.map((m) => [`${resolveNamespaceId(m)}:${m.modelName}`, m]),
  );

  const tablesByNamespace: Record<string, Record<string, StorageTableInput>> = {};
  const modelNameToNamespaceId = new Map<string, string>();
  const executionDefaults: ExecutionMutationDefault[] = [];
  const modelsByNamespace: Record<string, Record<string, ContractModel>> = {};
  const rootEntries: Array<{
    readonly tableName: string;
    readonly namespaceId: string;
    readonly ref: CrossReference;
  }> = [];

  for (const semanticModel of definition.models) {
    const tableName = semanticModel.tableName;
    const namespaceId =
      semanticModel.namespaceId !== undefined && semanticModel.namespaceId.length > 0
        ? semanticModel.namespaceId
        : defaultNamespaceId;
    modelNameToNamespaceId.set(semanticModel.modelName, namespaceId);
    // STI variants share the base table; the base model already owns this
    // table name and its root, so the variant contributes neither.
    if (!semanticModel.sharesBaseTable) {
      rootEntries.push({
        tableName,
        namespaceId,
        ref: crossRef(semanticModel.modelName, namespaceId),
      });
    }

    // --- Build storage table ---

    const columns: Record<string, StorageColumn> = {};
    const fieldToColumn: Record<string, string> = {};
    const domainFields: Record<string, ContractField> = {};
    const domainFieldRefs: Record<string, DomainFieldRef> = {};
    const checksForTable: CheckConstraintInput[] = [];

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

      const enumHandle = !isValueObjectField(field) ? field.enumTypeHandle : undefined;
      // Authored enums are always registered under the contract's defaultNamespaceId
      // (see the enum registration loop below), so refs must point there regardless
      // of which namespace the consuming model lives in.
      const storageValueSetRef: ValueSetRef | undefined =
        enumHandle !== undefined
          ? {
              plane: 'storage',
              entityKind: 'valueSet',
              namespaceId: defaultNamespaceId,
              entityName: enumHandle.enumName,
            }
          : undefined;
      const domainValueSetRef: ValueSetRef | undefined =
        enumHandle !== undefined
          ? {
              plane: 'domain',
              entityKind: 'enum',
              namespaceId: defaultNamespaceId,
              entityName: enumHandle.enumName,
            }
          : undefined;

      const column = buildStorageColumn(field, storageValueSetRef, codecLookup);
      columns[field.columnName] = column;
      fieldToColumn[field.fieldName] = field.columnName;

      // A domain enum (`storageValueSetRef`, from an `enumType()` handle) is
      // stored as a plain scalar column (`text`, `int4`, …) with no native
      // type of its own to enforce membership, so it needs an explicit
      // CHECK. A value set resolved by an entity-ref type constructor
      // (`field.descriptor.valueSet`, e.g. `pg.enum(Ref)`) binds the column
      // to a codec/native-type pairing that IS the storage-level
      // enforcement (a Postgres native enum type, or another target's
      // equivalent) — no CHECK for those, except a `many` (list) column:
      // a native per-instance type only constrains a scalar column, not
      // each element of an array.
      if (
        column.valueSet !== undefined &&
        (field.many === true || storageValueSetRef !== undefined)
      ) {
        checksForTable.push({
          name: `${tableName}_${field.columnName}_check`,
          column: field.columnName,
          valueSet: column.valueSet,
        });
      }

      domainFields[field.fieldName] = buildDomainField(field, column, domainValueSetRef);

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
          ref: { namespace: namespaceId, table: tableName, column: field.columnName },
          ...ifDefined('onCreate', executionDefaultPhases.onCreate),
          ...ifDefined('onUpdate', executionDefaultPhases.onUpdate),
        });
      }
    }

    const foreignKeys = (semanticModel.foreignKeys ?? []).map((fk) => {
      if (fk.references.spaceId !== undefined) {
        // Cross-space FK: the target lives in a different contract space.
        // Skip local model lookup and carry the spaceId coordinate through.
        const targetNamespaceId = fk.references.namespaceId ?? defaultNamespaceId;
        return {
          source: { namespaceId: asNamespaceId(namespaceId), tableName, columns: fk.columns },
          target: {
            namespaceId: asNamespaceId(targetNamespaceId),
            tableName: fk.references.table,
            columns: fk.references.columns,
            spaceId: fk.references.spaceId,
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
      }

      const targetModel = assertKnownTargetModel(
        modelsByName,
        modelsByCoordinate,
        semanticModel.modelName,
        fk.references.model,
        fk.references.namespaceId,
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

    // STI variants share the base table: their columns are already
    // materialised onto the base `ModelNode`, so the variant builds a domain
    // model (below) but no storage table of its own.
    if (!semanticModel.sharesBaseTable) {
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
        ...(checksForTable.length > 0 ? { checks: checksForTable } : {}),
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
      nsTables[tableName] = tableInput;
    }

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
      // Cross-space relations have `spaceId` set — the target model lives in
      // a different contract space, so skip local model lookup and validation.
      if (relation.spaceId !== undefined) {
        const targetNamespaceId = relation.namespaceId ?? defaultNamespaceId;
        modelRelations[relation.fieldName] = {
          to: crossRef(relation.toModel, targetNamespaceId, relation.spaceId),
          // Cross-space belongsTo relations are always N:1 (the FK-owning side).
          cardinality: 'N:1',
          on: {
            localFields: relation.on.parentColumns.map((col) => columnToField.get(col) ?? col),
            // For cross-space targets the lowering carries field names directly
            // (no fieldToColumn map available for the remote model).
            targetFields: relation.on.childColumns,
          },
        };
        continue;
      }

      const targetModel = assertKnownTargetModel(
        modelsByName,
        modelsByCoordinate,
        semanticModel.modelName,
        relation.toModel,
        relation.toNamespaceId,
        'Relation',
      );
      assertTargetTableMatches(semanticModel.modelName, targetModel, relation.toTable, 'Relation');

      const targetColumnToField = new Map(
        targetModel.fields.map((f) => [f.columnName, f.fieldName]),
      );

      const to = crossRef(
        relation.toModel,
        relation.toNamespaceId !== undefined && relation.toNamespaceId.length > 0
          ? relation.toNamespaceId
          : resolveModelNamespaceId(targetModel, modelNameToNamespaceId, defaultNamespaceId),
      );
      const on = {
        localFields: relation.on.parentColumns.map((col) => columnToField.get(col) ?? col),
        targetFields: relation.on.childColumns.map((col) => targetColumnToField.get(col) ?? col),
      };

      if (relation.cardinality === 'N:M') {
        if (!relation.through) {
          throw new Error(
            `Relation "${semanticModel.modelName}.${relation.fieldName}" with cardinality "N:M" requires through metadata`,
          );
        }
        modelRelations[relation.fieldName] = {
          to,
          cardinality: 'N:M',
          on,
          through: buildThroughDescriptor(
            relation.through,
            tableNamespaceByName,
            targetModel,
            semanticModel.modelName,
            relation.fieldName,
            defaultNamespaceId,
          ),
        };
      } else {
        modelRelations[relation.fieldName] = { to, cardinality: relation.cardinality, on };
      }
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

  // Aggregate roots are keyed by bare storage table name. When two models in
  // different namespaces map to the same bare table name, the bare key would
  // collide (last write wins, silently dropping a root), so those entries fall
  // back to a namespace-qualified key. Single-namespace contracts never
  // collide and keep their bare keys unchanged.
  const rootTableNameCounts = new Map<string, number>();
  for (const entry of rootEntries) {
    rootTableNameCounts.set(entry.tableName, (rootTableNameCounts.get(entry.tableName) ?? 0) + 1);
  }
  const roots: Record<string, CrossReference> = {};
  for (const entry of rootEntries) {
    const key =
      (rootTableNameCounts.get(entry.tableName) ?? 0) > 1
        ? `${entry.namespaceId}.${entry.tableName}`
        : entry.tableName;
    roots[key] = entry.ref;
  }

  // Normalise raw codec-triple inputs to the `kind: 'codec-instance'`
  // discriminator shape before hashing so the storageHash matches the
  // persisted JSON envelope produced from the SqlStorage class instance
  // (which always carries the discriminator).
  const rawStorageTypes = definition.storageTypes ?? {};
  const documentTypes: Record<string, StorageTypeInstance> = Object.fromEntries(
    Object.entries(rawStorageTypes).map(([name, entry]) => {
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
  const namespaceCoordinateIds = collectStorageNamespaceCoordinateIds(definition);

  // Build per-namespace registries for `enumType()` handles.
  // All authored enums target the contract's default namespace.
  const domainEnumsByNs: Record<string, Record<string, ContractEnum>> = {};
  const storageValueSetsByNs: Record<string, Record<string, StorageValueSetInput>> = {};
  for (const [enumName, handle] of Object.entries(definition.enums ?? {})) {
    if (enumName !== handle.enumName) {
      throw new Error(
        `enum declaration key "${enumName}" must match enumType name "${handle.enumName}". Aliases are not supported.`,
      );
    }
    const nsId = defaultNamespaceId;
    let domainSlot = domainEnumsByNs[nsId];
    if (domainSlot === undefined) {
      domainSlot = {};
      domainEnumsByNs[nsId] = domainSlot;
    }
    domainSlot[enumName] = {
      codecId: handle.codecId,
      members: handle.enumMembers.map((m) => ({
        name: m.name,
        value: encodeViaCodec(m.value, handle.codecId, codecLookup),
      })),
    };

    let storageSlot = storageValueSetsByNs[nsId];
    if (storageSlot === undefined) {
      storageSlot = {};
      storageValueSetsByNs[nsId] = storageSlot;
    }
    storageSlot[enumName] = {
      kind: 'valueSet',
      values: handle.values.map((v) => encodeViaCodec(v, handle.codecId, codecLookup)),
    };
  }

  const { createNamespace } = definition;
  const namespaces: SqlStorageInput['namespaces'] = Object.fromEntries(
    [...namespaceCoordinateIds].sort().map((id) => {
      const valueSetEntries = storageValueSetsByNs[id];
      const nsInput: SqlNamespaceInput = {
        id,
        entries: {
          table: tablesByNamespace[id] ?? {},
          ...(valueSetEntries !== undefined && Object.keys(valueSetEntries).length > 0
            ? { valueSet: valueSetEntries }
            : {}),
        },
      };
      return [id, createNamespace(nsInput)];
    }),
  );
  const storageWithoutHash = {
    ...(Object.keys(documentTypes).length > 0 ? { types: documentTypes } : {}),
    namespaces:
      defaultNamespaceId === UNBOUND_NAMESPACE_ID
        ? ensureUnboundNamespaceSlot(namespaces, createNamespace)
        : namespaces,
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
  for (const nsId of Object.keys(domainEnumsByNs)) {
    domainNamespaceIds.add(nsId);
  }
  const domainNamespaces = Object.fromEntries(
    [...domainNamespaceIds].sort().map((namespaceId) => {
      const modelsInNs = modelsByNamespace[namespaceId] ?? {};
      const enumsInNs = domainEnumsByNs[namespaceId];
      const namespaceSlice = {
        models: modelsInNs,
        ...(namespaceId === defaultNamespaceId && valueObjects !== undefined
          ? { valueObjects }
          : {}),
        ...(enumsInNs !== undefined && Object.keys(enumsInNs).length > 0
          ? { enum: enumsInNs }
          : {}),
      };
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
