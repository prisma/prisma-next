import type { ColumnTypeDescriptor } from '@prisma-next/framework-components/codec';
import type { ExtensionPackRef } from '@prisma-next/framework-components/components';
import type { StorageTypeInstance } from '@prisma-next/sql-contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import type {
  ContractDefinition,
  FieldNode,
  ForeignKeyNode,
  IndexNode,
  ModelNode,
  PrimaryKeyNode,
  RelationNode,
  UniqueConstraintNode,
} from './contract-definition';
import {
  applyNaming,
  type ContractInput,
  type ContractModelBuilder,
  type FieldStateOf,
  type ForeignKeyConstraint,
  type IdConstraint,
  type ModelAttributesSpec,
  normalizeRelationFieldNames,
  type RelationBuilder,
  type RelationState,
  resolveRelationModelName,
  type ScalarFieldBuilder,
  type SqlStageSpec,
  type UniqueConstraint,
} from './contract-dsl';
import {
  emitTypedCrossModelFallbackWarnings,
  emitTypedNamedTypeFallbackWarnings,
} from './contract-warnings';
import { isEnumTypeHandle } from './enum-type';

type RuntimeModel = ContractModelBuilder<
  string | undefined,
  Record<string, ScalarFieldBuilder>,
  Record<string, RelationBuilder<RelationState>>,
  ModelAttributesSpec | undefined,
  SqlStageSpec | undefined
>;

type RuntimeModelSpec = {
  readonly modelName: string;
  readonly tableName: string;
  readonly namespace: string | undefined;
  readonly fieldBuilders: Record<string, ScalarFieldBuilder>;
  readonly fieldToColumn: Record<string, string>;
  readonly relations: Record<string, RelationBuilder<RelationState>>;
  readonly attributesSpec: ModelAttributesSpec | undefined;
  readonly sqlSpec: SqlStageSpec | undefined;
  readonly idConstraint: IdConstraint | undefined;
};

type RuntimeCollection = {
  readonly storageTypes: Record<string, StorageTypeInstance>;
  readonly models: Record<string, RuntimeModel>;
  readonly modelSpecs: ReadonlyMap<string, RuntimeModelSpec>;
};

function buildStorageTypeReverseLookup(
  storageTypes: Record<string, StorageTypeInstance>,
): ReadonlyMap<StorageTypeInstance, string> {
  const lookup = new Map<StorageTypeInstance, string>();
  for (const [key, instance] of Object.entries(storageTypes)) {
    lookup.set(instance, key);
  }
  return lookup;
}

function resolveFieldDescriptor(
  modelName: string,
  fieldName: string,
  fieldState: FieldStateOf<ScalarFieldBuilder>,
  storageTypes: Record<string, StorageTypeInstance>,
  storageTypeReverseLookup: ReadonlyMap<StorageTypeInstance, string>,
): ColumnTypeDescriptor {
  if ('descriptor' in fieldState && fieldState.descriptor) {
    return fieldState.descriptor;
  }

  if ('typeRef' in fieldState && fieldState.typeRef) {
    if (isEnumTypeHandle(fieldState.typeRef)) {
      return {
        codecId: fieldState.typeRef.codecId,
        nativeType: fieldState.typeRef.nativeType,
      };
    }

    const typeRef =
      typeof fieldState.typeRef === 'string'
        ? fieldState.typeRef
        : storageTypeReverseLookup.get(fieldState.typeRef as StorageTypeInstance);

    if (!typeRef) {
      throw new Error(
        `Field "${modelName}.${fieldName}" references a storage type instance that is not present in definition.types`,
      );
    }

    const referencedType = storageTypes[typeRef];
    if (!referencedType) {
      throw new Error(
        `Field "${modelName}.${fieldName}" references unknown storage type "${typeRef}"`,
      );
    }

    return {
      codecId: referencedType.codecId,
      nativeType: referencedType.nativeType,
      typeRef,
    };
  }

  throw new Error(`Field "${modelName}.${fieldName}" does not resolve to a storage descriptor`);
}

function mapFieldNamesToColumnNames(
  modelName: string,
  fieldNames: readonly string[],
  fieldToColumn: Record<string, string>,
): readonly string[] {
  return fieldNames.map((fieldName) => {
    const columnName = fieldToColumn[fieldName];
    if (!columnName) {
      throw new Error(`Unknown field "${modelName}.${fieldName}" in contract definition`);
    }
    return columnName;
  });
}

function assertRelationFieldArity(params: {
  readonly modelName: string;
  readonly relationName: string;
  readonly leftLabel: string;
  readonly leftFields: readonly string[];
  readonly rightLabel: string;
  readonly rightFields: readonly string[];
}): void {
  if (params.leftFields.length === params.rightFields.length) {
    return;
  }

  throw new Error(
    `Relation "${params.modelName}.${params.relationName}" maps ${params.leftFields.length} ${params.leftLabel} field(s) to ${params.rightFields.length} ${params.rightLabel} field(s).`,
  );
}

function resolveInlineIdConstraint(
  spec: Pick<RuntimeModelSpec, 'modelName' | 'fieldBuilders'>,
): IdConstraint | undefined {
  const inlineIdFields: string[] = [];
  let idName: string | undefined;

  for (const [fieldName, fieldBuilder] of Object.entries(spec.fieldBuilders)) {
    const fieldState = fieldBuilder.build();
    if (!fieldState.id) {
      continue;
    }

    inlineIdFields.push(fieldName);
    if (fieldState.id.name) {
      idName = fieldState.id.name;
    }
  }

  if (inlineIdFields.length === 0) {
    return undefined;
  }

  if (inlineIdFields.length > 1) {
    throw new Error(
      `Model "${spec.modelName}" marks multiple fields with .id(). Use .attributes(...) for compound identities.`,
    );
  }

  const [inlineIdField] = inlineIdFields;
  if (!inlineIdField) {
    return undefined;
  }

  return {
    kind: 'id',
    fields: [inlineIdField],
    ...(idName ? { name: idName } : {}),
  };
}

function collectInlineUniqueConstraints(spec: RuntimeModelSpec): readonly UniqueConstraint[] {
  const constraints: UniqueConstraint[] = [];

  for (const [fieldName, fieldBuilder] of Object.entries(spec.fieldBuilders)) {
    const fieldState = fieldBuilder.build();
    if (!fieldState.unique) {
      continue;
    }

    constraints.push({
      kind: 'unique',
      fields: [fieldName],
      ...(fieldState.unique.name ? { name: fieldState.unique.name } : {}),
    });
  }

  return constraints;
}

function resolveModelIdConstraint(
  spec: Pick<RuntimeModelSpec, 'modelName' | 'fieldBuilders' | 'attributesSpec'>,
): IdConstraint | undefined {
  const inlineId = resolveInlineIdConstraint(spec);
  const attributeId = spec.attributesSpec?.id;

  if (inlineId && attributeId) {
    throw new Error(
      `Model "${spec.modelName}" defines identity both inline and in .attributes(...). Pick one identity style.`,
    );
  }

  const resolvedId = attributeId ?? inlineId;
  if (resolvedId && resolvedId.fields.length === 0) {
    throw new Error(`Model "${spec.modelName}" defines an empty identity. Add at least one field.`);
  }

  return resolvedId;
}

function resolveModelUniqueConstraints(spec: RuntimeModelSpec): readonly UniqueConstraint[] {
  const attributeUniques = spec.attributesSpec?.uniques ?? [];
  for (const unique of attributeUniques) {
    if (unique.fields.length === 0) {
      throw new Error(
        `Model "${spec.modelName}" defines an empty unique constraint. Add at least one field.`,
      );
    }
  }

  return [...collectInlineUniqueConstraints(spec), ...attributeUniques];
}

function resolveRelationForeignKeys(
  spec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
): readonly ForeignKeyConstraint[] {
  const foreignKeys: ForeignKeyConstraint[] = [];

  for (const [relationName, relationBuilder] of Object.entries(spec.relations)) {
    const relation = relationBuilder.build();
    if (relation.kind !== 'belongsTo' || !relation.sql?.fk) {
      continue;
    }

    const targetModelName = resolveRelationModelName(relation.toModel);

    // F-relfk: cross-space relations carry a spaceId; skip the local spec lookup
    // and include cross-space coordinates so resolveForeignKeyNodes routes the FK
    // through the cross-space path.
    if (relation.spaceId !== undefined) {
      const fields = normalizeRelationFieldNames(relation.from);
      const targetFields = normalizeRelationFieldNames(relation.to);
      assertRelationFieldArity({
        modelName: spec.modelName,
        relationName,
        leftLabel: 'source',
        leftFields: fields,
        rightLabel: 'target',
        rightFields: targetFields,
      });

      foreignKeys.push({
        kind: 'fk',
        fields,
        targetModel: targetModelName,
        targetFields,
        targetSpaceId: relation.spaceId,
        ...(relation.namespaceId !== undefined ? { targetNamespaceId: relation.namespaceId } : {}),
        ...(relation.tableName !== undefined ? { targetTableName: relation.tableName } : {}),
        ...(relation.sql.fk.name ? { name: relation.sql.fk.name } : {}),
        ...(relation.sql.fk.onDelete ? { onDelete: relation.sql.fk.onDelete } : {}),
        ...(relation.sql.fk.onUpdate ? { onUpdate: relation.sql.fk.onUpdate } : {}),
        ...(relation.sql.fk.constraint !== undefined
          ? { constraint: relation.sql.fk.constraint }
          : {}),
        ...(relation.sql.fk.index !== undefined ? { index: relation.sql.fk.index } : {}),
      });
      continue;
    }

    if (!allSpecs.has(targetModelName)) {
      throw new Error(
        `Relation "${spec.modelName}.${relationName}" references unknown model "${targetModelName}"`,
      );
    }

    const fields = normalizeRelationFieldNames(relation.from);
    const targetFields = normalizeRelationFieldNames(relation.to);
    assertRelationFieldArity({
      modelName: spec.modelName,
      relationName,
      leftLabel: 'source',
      leftFields: fields,
      rightLabel: 'target',
      rightFields: targetFields,
    });

    foreignKeys.push({
      kind: 'fk',
      fields,
      targetModel: targetModelName,
      targetFields,
      ...(relation.sql.fk.name ? { name: relation.sql.fk.name } : {}),
      ...(relation.sql.fk.onDelete ? { onDelete: relation.sql.fk.onDelete } : {}),
      ...(relation.sql.fk.onUpdate ? { onUpdate: relation.sql.fk.onUpdate } : {}),
      ...(relation.sql.fk.constraint !== undefined
        ? { constraint: relation.sql.fk.constraint }
        : {}),
      ...(relation.sql.fk.index !== undefined ? { index: relation.sql.fk.index } : {}),
    });
  }

  return foreignKeys;
}

function resolveRelationAnchorFields(spec: RuntimeModelSpec): readonly string[] {
  const idFields = spec.idConstraint?.fields;
  if (idFields && idFields.length > 0) {
    return idFields;
  }

  if ('id' in spec.fieldToColumn) {
    return ['id'];
  }

  throw new Error(
    `Model "${spec.modelName}" needs an explicit id or an "id" field to anchor non-owning relations`,
  );
}

function lowerBelongsToRelation(
  relationName: string,
  relation: Extract<RelationState, { kind: 'belongsTo' }>,
  currentSpec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
  extensionPacks?: Record<string, ExtensionPackRef<'sql', string>>,
): RelationNode {
  const targetModelName = resolveRelationModelName(relation.toModel);
  const fromFields = normalizeRelationFieldNames(relation.from);
  const toFields = normalizeRelationFieldNames(relation.to);

  assertRelationFieldArity({
    modelName: currentSpec.modelName,
    relationName,
    leftLabel: 'source',
    leftFields: fromFields,
    rightLabel: 'target',
    rightFields: toFields,
  });

  // Cross-space path: the target lives in a different contract space.
  // Resolve from the brand carried on the BelongsToRelation instead of
  // requiring a local model spec — matching how the FK lowering works.
  if (relation.spaceId !== undefined) {
    assertKnownExtensionPack(
      extensionPacks,
      relation.spaceId,
      `Relation "${currentSpec.modelName}.${relationName}"`,
    );
    const targetTable = relation.tableName ?? targetModelName.toLowerCase();
    const parentColumns = mapFieldNamesToColumnNames(
      currentSpec.modelName,
      fromFields,
      currentSpec.fieldToColumn,
    );
    // For cross-space relations, the `to` field names map directly to column
    // names because we have no fieldToColumn map for the remote model.
    // (The brand carries the table name; field→column resolution on the remote
    // side is deferred to the planner which has access to the remote contract.)
    return {
      fieldName: relationName,
      toModel: targetModelName,
      toTable: targetTable,
      cardinality: 'N:1',
      spaceId: relation.spaceId,
      ...(relation.namespaceId !== undefined ? { namespaceId: relation.namespaceId } : {}),
      on: {
        parentTable: currentSpec.tableName,
        parentColumns,
        childTable: targetTable,
        childColumns: toFields,
      },
    };
  }

  const targetSpec = allSpecs.get(targetModelName);
  if (!targetSpec) {
    throw new Error(
      `Relation "${currentSpec.modelName}.${relationName}" references unknown model "${targetModelName}"`,
    );
  }

  return {
    fieldName: relationName,
    toModel: targetModelName,
    toTable: targetSpec.tableName,
    cardinality: 'N:1',
    on: {
      parentTable: currentSpec.tableName,
      parentColumns: mapFieldNamesToColumnNames(
        currentSpec.modelName,
        fromFields,
        currentSpec.fieldToColumn,
      ),
      childTable: targetSpec.tableName,
      childColumns: mapFieldNamesToColumnNames(
        targetSpec.modelName,
        toFields,
        targetSpec.fieldToColumn,
      ),
    },
  };
}

function lowerHasOwnershipRelation(
  relationName: string,
  relation: Extract<RelationState, { kind: 'hasMany' | 'hasOne' }>,
  currentSpec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
): RelationNode {
  const targetModelName = resolveRelationModelName(relation.toModel);
  const targetSpec = allSpecs.get(targetModelName);
  if (!targetSpec) {
    throw new Error(
      `Relation "${currentSpec.modelName}.${relationName}" references unknown model "${targetModelName}"`,
    );
  }

  const parentFields = resolveRelationAnchorFields(currentSpec);
  const childFields = normalizeRelationFieldNames(relation.by);
  assertRelationFieldArity({
    modelName: currentSpec.modelName,
    relationName,
    leftLabel: 'anchor',
    leftFields: parentFields,
    rightLabel: 'child',
    rightFields: childFields,
  });

  return {
    fieldName: relationName,
    toModel: targetModelName,
    toTable: targetSpec.tableName,
    cardinality: relation.kind === 'hasMany' ? '1:N' : '1:1',
    on: {
      parentTable: currentSpec.tableName,
      parentColumns: mapFieldNamesToColumnNames(
        currentSpec.modelName,
        parentFields,
        currentSpec.fieldToColumn,
      ),
      childTable: targetSpec.tableName,
      childColumns: mapFieldNamesToColumnNames(
        targetSpec.modelName,
        childFields,
        targetSpec.fieldToColumn,
      ),
    },
  };
}

function lowerManyToManyRelation(
  relationName: string,
  relation: Extract<RelationState, { kind: 'manyToMany' }>,
  currentSpec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
): RelationNode {
  const targetModelName = resolveRelationModelName(relation.toModel);
  const targetSpec = allSpecs.get(targetModelName);
  if (!targetSpec) {
    throw new Error(
      `Relation "${currentSpec.modelName}.${relationName}" references unknown model "${targetModelName}"`,
    );
  }

  const throughModelName = resolveRelationModelName(relation.through);
  const throughSpec = allSpecs.get(throughModelName);
  if (!throughSpec) {
    throw new Error(
      `Relation "${currentSpec.modelName}.${relationName}" references unknown through model "${throughModelName}"`,
    );
  }

  const currentAnchorFields = resolveRelationAnchorFields(currentSpec);
  const targetAnchorFields = resolveRelationAnchorFields(targetSpec);
  const throughFromFields = normalizeRelationFieldNames(relation.from);
  const throughToFields = normalizeRelationFieldNames(relation.to);
  if (
    currentAnchorFields.length !== throughFromFields.length ||
    targetAnchorFields.length !== throughToFields.length
  ) {
    throw new Error(
      `Relation "${currentSpec.modelName}.${relationName}" has mismatched many-to-many field counts.`,
    );
  }

  return {
    fieldName: relationName,
    toModel: targetModelName,
    toTable: targetSpec.tableName,
    cardinality: 'N:M',
    through: {
      table: throughSpec.tableName,
      ...ifDefined('namespaceId', throughSpec.namespace),
      parentColumns: mapFieldNamesToColumnNames(
        throughSpec.modelName,
        throughFromFields,
        throughSpec.fieldToColumn,
      ),
      childColumns: mapFieldNamesToColumnNames(
        throughSpec.modelName,
        throughToFields,
        throughSpec.fieldToColumn,
      ),
    },
    on: {
      parentTable: currentSpec.tableName,
      parentColumns: mapFieldNamesToColumnNames(
        currentSpec.modelName,
        currentAnchorFields,
        currentSpec.fieldToColumn,
      ),
      childTable: throughSpec.tableName,
      childColumns: mapFieldNamesToColumnNames(
        throughSpec.modelName,
        throughFromFields,
        throughSpec.fieldToColumn,
      ),
    },
  };
}

function resolveRelationNode(
  relationName: string,
  relation: RelationState,
  currentSpec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
  extensionPacks?: Record<string, ExtensionPackRef<'sql', string>>,
): RelationNode {
  if (relation.kind === 'belongsTo') {
    return lowerBelongsToRelation(relationName, relation, currentSpec, allSpecs, extensionPacks);
  }

  if (relation.kind === 'hasMany' || relation.kind === 'hasOne') {
    return lowerHasOwnershipRelation(relationName, relation, currentSpec, allSpecs);
  }

  return lowerManyToManyRelation(relationName, relation, currentSpec, allSpecs);
}

function lowerLocalForeignKeyNode(
  spec: RuntimeModelSpec,
  targetSpec: RuntimeModelSpec,
  foreignKey: {
    readonly fields: readonly string[];
    readonly targetFields: readonly string[];
    readonly name?: string | undefined;
    readonly onDelete?: ForeignKeyConstraint['onDelete'] | undefined;
    readonly onUpdate?: ForeignKeyConstraint['onUpdate'] | undefined;
    readonly constraint?: boolean | undefined;
    readonly index?: boolean | undefined;
  },
): ForeignKeyNode {
  return {
    columns: mapFieldNamesToColumnNames(spec.modelName, foreignKey.fields, spec.fieldToColumn),
    references: {
      model: targetSpec.modelName,
      table: targetSpec.tableName,
      columns: mapFieldNamesToColumnNames(
        targetSpec.modelName,
        foreignKey.targetFields,
        targetSpec.fieldToColumn,
      ),
    },
    ...(foreignKey.name ? { name: foreignKey.name } : {}),
    ...(foreignKey.onDelete ? { onDelete: foreignKey.onDelete } : {}),
    ...(foreignKey.onUpdate ? { onUpdate: foreignKey.onUpdate } : {}),
    ...(foreignKey.constraint !== undefined ? { constraint: foreignKey.constraint } : {}),
    ...(foreignKey.index !== undefined ? { index: foreignKey.index } : {}),
  };
}

function lowerCrossSpaceForeignKeyNode(
  spec: RuntimeModelSpec,
  foreignKey: {
    readonly fields: readonly string[];
    readonly targetFields: readonly string[];
    readonly targetModel: string;
    readonly targetSpaceId: string;
    readonly targetNamespaceId?: string;
    readonly targetTableName?: string;
    readonly name?: string | undefined;
    readonly onDelete?: ForeignKeyConstraint['onDelete'] | undefined;
    readonly onUpdate?: ForeignKeyConstraint['onUpdate'] | undefined;
    readonly constraint?: boolean | undefined;
    readonly index?: boolean | undefined;
  },
): ForeignKeyNode {
  return {
    columns: mapFieldNamesToColumnNames(spec.modelName, foreignKey.fields, spec.fieldToColumn),
    references: {
      model: foreignKey.targetModel,
      table: foreignKey.targetTableName ?? foreignKey.targetModel.toLowerCase(),
      columns: foreignKey.targetFields,
      ...(foreignKey.targetNamespaceId !== undefined
        ? { namespaceId: foreignKey.targetNamespaceId }
        : {}),
      spaceId: foreignKey.targetSpaceId,
    },
    ...(foreignKey.name ? { name: foreignKey.name } : {}),
    ...(foreignKey.onDelete ? { onDelete: foreignKey.onDelete } : {}),
    ...(foreignKey.onUpdate ? { onUpdate: foreignKey.onUpdate } : {}),
    ...(foreignKey.constraint !== undefined ? { constraint: foreignKey.constraint } : {}),
    ...(foreignKey.index !== undefined ? { index: foreignKey.index } : {}),
  };
}

function assertKnownExtensionPack(
  extensionPacks: Record<string, ExtensionPackRef<'sql', string>> | undefined,
  spaceId: string,
  context: string,
): void {
  if (extensionPacks !== undefined && Object.hasOwn(extensionPacks, spaceId)) {
    return;
  }
  throw new Error(
    `${context} references contract space "${spaceId}" but "${spaceId}" is not declared in extensionPacks. Add the pack to extensionPacks.`,
  );
}

function resolveForeignKeyNodes(
  spec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
  extensionPacks?: Record<string, ExtensionPackRef<'sql', string>>,
): readonly ForeignKeyNode[] {
  const relationForeignKeys = resolveRelationForeignKeys(spec, allSpecs).map((foreignKey) => {
    // F-relfk: relation-derived FKs for cross-space targets carry targetSpaceId;
    // route them through the cross-space path, just like explicit sql() FKs.
    if (foreignKey.targetSpaceId !== undefined) {
      assertKnownExtensionPack(
        extensionPacks,
        foreignKey.targetSpaceId,
        `Relation-derived foreign key on "${spec.modelName}"`,
      );
      return lowerCrossSpaceForeignKeyNode(spec, {
        ...foreignKey,
        targetSpaceId: foreignKey.targetSpaceId,
      });
    }

    const targetSpec = allSpecs.get(foreignKey.targetModel);
    if (!targetSpec) {
      throw new Error(
        `Foreign key on "${spec.modelName}" references unknown model "${foreignKey.targetModel}"`,
      );
    }

    return lowerLocalForeignKeyNode(spec, targetSpec, foreignKey);
  });

  const sqlForeignKeys = (spec.sqlSpec?.foreignKeys ?? []).map((foreignKey) => {
    if (foreignKey.targetSpaceId !== undefined) {
      assertKnownExtensionPack(
        extensionPacks,
        foreignKey.targetSpaceId,
        `Foreign key on "${spec.modelName}"`,
      );
      return lowerCrossSpaceForeignKeyNode(spec, {
        ...foreignKey,
        targetSpaceId: foreignKey.targetSpaceId,
      });
    }

    const targetSpec = allSpecs.get(foreignKey.targetModel);
    if (!targetSpec) {
      throw new Error(
        `Foreign key on "${spec.modelName}" references unknown model "${foreignKey.targetModel}"`,
      );
    }

    return lowerLocalForeignKeyNode(spec, targetSpec, foreignKey);
  });

  return [...relationForeignKeys, ...sqlForeignKeys];
}

function resolveModelNode(
  spec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
  storageTypes: Record<string, StorageTypeInstance>,
  storageTypeReverseLookup: ReadonlyMap<StorageTypeInstance, string>,
  extensionPacks?: Record<string, ExtensionPackRef<'sql', string>>,
): ModelNode {
  const fields: FieldNode[] = [];

  for (const [fieldName, fieldBuilder] of Object.entries(spec.fieldBuilders)) {
    const fieldState = fieldBuilder.build();
    const descriptor = resolveFieldDescriptor(
      spec.modelName,
      fieldName,
      fieldState,
      storageTypes,
      storageTypeReverseLookup,
    );
    const columnName = spec.fieldToColumn[fieldName];
    if (!columnName) {
      throw new Error(`Column name resolution failed for "${spec.modelName}.${fieldName}"`);
    }

    const enumHandle =
      'typeRef' in fieldState && isEnumTypeHandle(fieldState.typeRef)
        ? fieldState.typeRef
        : undefined;

    fields.push({
      fieldName,
      columnName,
      descriptor,
      nullable: fieldState.nullable,
      ...(fieldState.many === true ? { many: true } : {}),
      ...(fieldState.default ? { default: fieldState.default } : {}),
      ...(fieldState.executionDefaults ? { executionDefaults: fieldState.executionDefaults } : {}),
      ...(enumHandle !== undefined ? { enumTypeHandle: enumHandle } : {}),
    });
  }

  const { idConstraint } = spec;
  const uniques = resolveModelUniqueConstraints(spec).map((unique) => ({
    columns: mapFieldNamesToColumnNames(spec.modelName, unique.fields, spec.fieldToColumn),
    ...(unique.name ? { name: unique.name } : {}),
  })) satisfies readonly UniqueConstraintNode[];
  const indexes = (spec.sqlSpec?.indexes ?? []).map((index) => ({
    columns: mapFieldNamesToColumnNames(spec.modelName, index.fields, spec.fieldToColumn),
    ...ifDefined('name', index.name),
    ...ifDefined('type', index.type),
    ...ifDefined('options', index.options),
  })) satisfies readonly IndexNode[];
  const foreignKeys = resolveForeignKeyNodes(spec, allSpecs, extensionPacks);
  const relations = Object.entries(spec.relations).map(([relationName, relationBuilder]) =>
    resolveRelationNode(relationName, relationBuilder.build(), spec, allSpecs, extensionPacks),
  );

  return {
    modelName: spec.modelName,
    tableName: spec.tableName,
    ...(spec.namespace !== undefined ? { namespaceId: spec.namespace } : {}),
    fields,
    ...(idConstraint
      ? {
          id: {
            columns: mapFieldNamesToColumnNames(
              spec.modelName,
              idConstraint.fields,
              spec.fieldToColumn,
            ),
            ...(idConstraint.name ? { name: idConstraint.name } : {}),
          } satisfies PrimaryKeyNode,
        }
      : {}),
    ...(uniques.length > 0 ? { uniques } : {}),
    ...(indexes.length > 0 ? { indexes } : {}),
    ...(foreignKeys.length > 0 ? { foreignKeys } : {}),
    ...(relations.length > 0 ? { relations } : {}),
    ...ifDefined('control', spec.sqlSpec?.control),
  };
}

function collectRuntimeModelSpecs(definition: ContractInput): RuntimeCollection {
  const storageTypes = { ...(definition.types ?? {}) } as Record<string, StorageTypeInstance>;
  const models = { ...(definition.models ?? {}) } as Record<string, RuntimeModel>;

  emitTypedNamedTypeFallbackWarnings(models, storageTypes);

  const modelSpecs = new Map<string, RuntimeModelSpec>();
  const tableOwners = new Map<string, string>();

  for (const [modelName, modelDefinition] of Object.entries(models)) {
    const tokenModelName = modelDefinition.stageOne.modelName;
    if (tokenModelName && tokenModelName !== modelName) {
      throw new Error(
        `Model token "${tokenModelName}" must be assigned to models.${tokenModelName}. Received models.${modelName}.`,
      );
    }

    const attributesSpec = modelDefinition.buildAttributesSpec();
    const sqlSpec = modelDefinition.buildSqlSpec();
    const tableName = sqlSpec?.table ?? applyNaming(modelName, definition.naming?.tables);
    // Table names are unique per namespace, not globally. Key the collision
    // check by a tuple so namespace/table boundaries remain unambiguous.
    const namespaceId = modelDefinition.stageOne.namespace ?? definition.target.defaultNamespaceId;
    const tableKey = JSON.stringify([namespaceId, tableName]);
    const existingModel = tableOwners.get(tableKey);
    if (existingModel) {
      throw new Error(
        `Models "${existingModel}" and "${modelName}" both map to table "${tableName}".`,
      );
    }
    tableOwners.set(tableKey, modelName);

    const fieldToColumn: Record<string, string> = {};
    const columnOwners = new Map<string, string>();

    for (const [fieldName, fieldBuilder] of Object.entries(modelDefinition.stageOne.fields)) {
      const fieldState = fieldBuilder.build();
      const columnName =
        fieldState.columnName ?? applyNaming(fieldName, definition.naming?.columns);
      const existingField = columnOwners.get(columnName);
      if (existingField) {
        throw new Error(
          `Model "${modelName}" maps both "${existingField}" and "${fieldName}" to column "${columnName}".`,
        );
      }
      columnOwners.set(columnName, fieldName);
      fieldToColumn[fieldName] = columnName;
    }

    const fieldBuilders = modelDefinition.stageOne.fields;
    const idConstraint = resolveModelIdConstraint({ modelName, fieldBuilders, attributesSpec });
    modelSpecs.set(modelName, {
      modelName,
      tableName,
      namespace: modelDefinition.stageOne.namespace,
      fieldBuilders,
      fieldToColumn,
      relations: modelDefinition.stageOne.relations,
      attributesSpec,
      sqlSpec,
      idConstraint,
    });
  }

  return {
    storageTypes,
    models,
    modelSpecs,
  };
}

function lowerModels(
  collection: RuntimeCollection,
  extensionPacks?: Record<string, ExtensionPackRef<'sql', string>>,
): readonly ModelNode[] {
  emitTypedCrossModelFallbackWarnings(collection);

  const storageTypeReverseLookup = buildStorageTypeReverseLookup(collection.storageTypes);
  return Array.from(collection.modelSpecs.values()).map((spec) =>
    resolveModelNode(
      spec,
      collection.modelSpecs,
      collection.storageTypes,
      storageTypeReverseLookup,
      extensionPacks,
    ),
  );
}

export function buildContractDefinition(definition: ContractInput): ContractDefinition {
  const collection = collectRuntimeModelSpecs(definition);
  const models = lowerModels(collection, definition.extensionPacks);

  return {
    target: definition.target,
    ...ifDefined('defaultControlPolicy', definition.defaultControlPolicy),
    ...(definition.extensionPacks ? { extensionPacks: definition.extensionPacks } : {}),
    ...(definition.storageHash ? { storageHash: definition.storageHash } : {}),
    ...(definition.foreignKeyDefaults ? { foreignKeyDefaults: definition.foreignKeyDefaults } : {}),
    ...(Object.keys(collection.storageTypes).length > 0
      ? { storageTypes: collection.storageTypes }
      : {}),
    ...(definition.namespaces ? { namespaces: definition.namespaces } : {}),
    ...(definition.createNamespace ? { createNamespace: definition.createNamespace } : {}),
    ...(definition.enums && Object.keys(definition.enums).length > 0
      ? { enums: definition.enums }
      : {}),
    models,
  };
}
