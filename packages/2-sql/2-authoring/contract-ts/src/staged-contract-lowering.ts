import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';
import type { StorageTypeInstance } from '@prisma-next/sql-contract/types';
import type {
  SqlSemanticContractDefinition,
  SqlSemanticFieldNode,
  SqlSemanticForeignKeyNode,
  SqlSemanticIndexNode,
  SqlSemanticModelNode,
  SqlSemanticPrimaryKeyNode,
  SqlSemanticRelationNode,
  SqlSemanticUniqueConstraintNode,
} from './semantic-contract';
import {
  applyNaming,
  type FieldStateOf,
  type ForeignKeyConstraint,
  type IdConstraint,
  type ModelAttributesSpec,
  normalizeRelationFieldNames,
  type RelationBuilder,
  resolveRelationModelName,
  type ScalarFieldBuilder,
  type SqlStageSpec,
  type StagedContractInput,
  type StagedModelBuilder,
  type RelationState as StagedRelationState,
  type UniqueConstraint,
} from './staged-contract-dsl';

type RuntimeStagedModel = StagedModelBuilder<
  string | undefined,
  Record<string, ScalarFieldBuilder>,
  Record<string, RelationBuilder<StagedRelationState>>,
  ModelAttributesSpec | undefined,
  SqlStageSpec | undefined
>;

type RuntimeModelSpec = {
  readonly modelName: string;
  readonly tableName: string;
  readonly fieldBuilders: Record<string, ScalarFieldBuilder>;
  readonly fieldToColumn: Record<string, string>;
  readonly relations: Record<string, RelationBuilder<StagedRelationState>>;
  readonly attributesSpec: ModelAttributesSpec | undefined;
  readonly sqlSpec: SqlStageSpec | undefined;
};

type RuntimeStagedCollection = {
  readonly storageTypes: Record<string, StorageTypeInstance>;
  readonly models: Record<string, RuntimeStagedModel>;
  readonly modelSpecs: ReadonlyMap<string, RuntimeModelSpec>;
};

function resolveFieldDescriptor(
  modelName: string,
  fieldName: string,
  fieldState: FieldStateOf<ScalarFieldBuilder>,
  storageTypes: Record<string, StorageTypeInstance>,
): ColumnTypeDescriptor {
  if ('descriptor' in fieldState && fieldState.descriptor) {
    return fieldState.descriptor;
  }

  if ('typeRef' in fieldState && fieldState.typeRef) {
    const typeRef =
      typeof fieldState.typeRef === 'string'
        ? fieldState.typeRef
        : Object.entries(storageTypes).find(
            ([, storageType]) => storageType === fieldState.typeRef,
          )?.[0];

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

function hasNamedModelToken(
  models: Record<string, RuntimeStagedModel>,
  modelName: string,
): boolean {
  return models[modelName]?.stageOne.modelName === modelName;
}

function formatFieldSelection(fieldNames: readonly string[]): string {
  if (fieldNames.length === 1) {
    return `'${fieldNames[0]}'`;
  }

  return `[${fieldNames.map((fieldName) => `'${fieldName}'`).join(', ')}]`;
}

function formatTokenFieldSelection(modelName: string, fieldNames: readonly string[]): string {
  if (fieldNames.length === 1) {
    return `${modelName}.refs.${fieldNames[0]}`;
  }

  return `[${fieldNames.map((fieldName) => `${modelName}.refs.${fieldName}`).join(', ')}]`;
}

function formatConstraintsRefCall(modelName: string, fieldNames: readonly string[]): string {
  if (fieldNames.length === 1) {
    return `constraints.ref('${modelName}', '${fieldNames[0]}')`;
  }

  return `[${fieldNames
    .map((fieldName) => `constraints.ref('${modelName}', '${fieldName}')`)
    .join(', ')}]`;
}

function formatRelationModelDisplay(
  relationModel:
    | StagedRelationState['toModel']
    | Extract<StagedRelationState, { kind: 'manyToMany' }>['through'],
): string {
  if (relationModel.kind === 'lazyRelationModelName') {
    return `() => ${relationModel.resolve()}`;
  }

  return relationModel.source === 'string'
    ? `'${relationModel.modelName}'`
    : relationModel.modelName;
}

function formatBelongsToFallbackCall(
  targetModelDisplay: string,
  fromFields: readonly string[],
  toFields: readonly string[],
): string {
  return `rel.belongsTo(${targetModelDisplay}, { from: ${formatFieldSelection(fromFields)}, to: ${formatFieldSelection(toFields)} })`;
}

function formatHasOwnershipFallbackCall(
  helperName: 'hasMany' | 'hasOne',
  targetModelDisplay: string,
  byFields: readonly string[],
): string {
  return `rel.${helperName}(${targetModelDisplay}, { by: ${formatFieldSelection(byFields)} })`;
}

function formatManyToManyFallbackCall(
  targetModelDisplay: string,
  throughModelDisplay: string,
  fromFields: readonly string[],
  toFields: readonly string[],
): string {
  return `rel.manyToMany(${targetModelDisplay}, { through: ${throughModelDisplay}, from: ${formatFieldSelection(fromFields)}, to: ${formatFieldSelection(toFields)} })`;
}

function emitTypedNamedTypeFallbackWarnings(
  models: Record<string, RuntimeStagedModel>,
  storageTypes: Record<string, StorageTypeInstance>,
): void {
  const warnedFields = new Set<string>();

  for (const [modelName, modelDefinition] of Object.entries(models)) {
    for (const [fieldName, fieldBuilder] of Object.entries(modelDefinition.stageOne.fields)) {
      const fieldState = fieldBuilder.build();
      if (typeof fieldState.typeRef !== 'string' || !(fieldState.typeRef in storageTypes)) {
        continue;
      }

      const warningKey = `${modelName}.${fieldName}`;
      if (warnedFields.has(warningKey)) {
        continue;
      }
      warnedFields.add(warningKey);

      process.emitWarning(
        `Staged contract field "${modelName}.${fieldName}" uses field.namedType('${fieldState.typeRef}'). ` +
          `Use field.namedType(types.${fieldState.typeRef}) when the storage type is declared in the same contract to keep autocomplete and typed local refs.`,
        {
          code: 'PN_CONTRACT_TYPED_FALLBACK_AVAILABLE',
        },
      );
    }
  }
}

function emitTypedCrossModelFallbackWarnings(collection: RuntimeStagedCollection): void {
  const warnedKeys = new Set<string>();

  for (const spec of collection.modelSpecs.values()) {
    for (const [relationName, relationBuilder] of Object.entries(spec.relations)) {
      const relation = relationBuilder.build();

      if (
        relation.toModel.kind === 'relationModelName' &&
        relation.toModel.source === 'string' &&
        hasNamedModelToken(collection.models, relation.toModel.modelName)
      ) {
        const warningKey = `${spec.modelName}.${relationName}.toModel`;
        if (!warnedKeys.has(warningKey)) {
          warnedKeys.add(warningKey);

          const relationCall =
            relation.kind === 'belongsTo'
              ? formatBelongsToFallbackCall(
                  `'${relation.toModel.modelName}'`,
                  normalizeRelationFieldNames(relation.from),
                  normalizeRelationFieldNames(relation.to),
                )
              : relation.kind === 'hasMany'
                ? formatHasOwnershipFallbackCall(
                    'hasMany',
                    `'${relation.toModel.modelName}'`,
                    normalizeRelationFieldNames(relation.by),
                  )
                : relation.kind === 'hasOne'
                  ? formatHasOwnershipFallbackCall(
                      'hasOne',
                      `'${relation.toModel.modelName}'`,
                      normalizeRelationFieldNames(relation.by),
                    )
                  : formatManyToManyFallbackCall(
                      `'${relation.toModel.modelName}'`,
                      formatRelationModelDisplay(relation.through),
                      normalizeRelationFieldNames(relation.from),
                      normalizeRelationFieldNames(relation.to),
                    );

          const suggestion =
            relation.kind === 'belongsTo'
              ? formatBelongsToFallbackCall(
                  relation.toModel.modelName,
                  normalizeRelationFieldNames(relation.from),
                  normalizeRelationFieldNames(relation.to),
                )
              : relation.kind === 'hasMany'
                ? formatHasOwnershipFallbackCall(
                    'hasMany',
                    relation.toModel.modelName,
                    normalizeRelationFieldNames(relation.by),
                  )
                : relation.kind === 'hasOne'
                  ? formatHasOwnershipFallbackCall(
                      'hasOne',
                      relation.toModel.modelName,
                      normalizeRelationFieldNames(relation.by),
                    )
                  : formatManyToManyFallbackCall(
                      relation.toModel.modelName,
                      formatRelationModelDisplay(relation.through),
                      normalizeRelationFieldNames(relation.from),
                      normalizeRelationFieldNames(relation.to),
                    );

          process.emitWarning(
            `Staged contract relation "${spec.modelName}.${relationName}" uses ${relationCall}. ` +
              `Use ${suggestion} when the named model token is available in the same contract to keep typed relation targets and model refs.`,
            {
              code: 'PN_CONTRACT_TYPED_FALLBACK_AVAILABLE',
            },
          );
        }
      }

      if (
        relation.kind === 'manyToMany' &&
        relation.through.kind === 'relationModelName' &&
        relation.through.source === 'string' &&
        hasNamedModelToken(collection.models, relation.through.modelName)
      ) {
        const warningKey = `${spec.modelName}.${relationName}.through`;
        if (!warnedKeys.has(warningKey)) {
          warnedKeys.add(warningKey);

          const relationCall = formatManyToManyFallbackCall(
            formatRelationModelDisplay(relation.toModel),
            `'${relation.through.modelName}'`,
            normalizeRelationFieldNames(relation.from),
            normalizeRelationFieldNames(relation.to),
          );
          const suggestion = formatManyToManyFallbackCall(
            formatRelationModelDisplay(relation.toModel),
            relation.through.modelName,
            normalizeRelationFieldNames(relation.from),
            normalizeRelationFieldNames(relation.to),
          );

          process.emitWarning(
            `Staged contract relation "${spec.modelName}.${relationName}" uses ${relationCall}. ` +
              `Use ${suggestion} when the named model token is available in the same contract to keep typed relation targets and model refs.`,
            {
              code: 'PN_CONTRACT_TYPED_FALLBACK_AVAILABLE',
            },
          );
        }
      }
    }

    for (const [foreignKeyIndex, foreignKey] of (spec.sqlSpec?.foreignKeys ?? []).entries()) {
      if (
        foreignKey.targetSource !== 'string' ||
        !hasNamedModelToken(collection.models, foreignKey.targetModel)
      ) {
        continue;
      }

      const warningKey = `${spec.modelName}.sql.foreignKeys.${foreignKeyIndex}`;
      if (warnedKeys.has(warningKey)) {
        continue;
      }
      warnedKeys.add(warningKey);

      process.emitWarning(
        `Staged contract model "${spec.modelName}" uses ${formatConstraintsRefCall(foreignKey.targetModel, foreignKey.targetFields)} in .sql(...). ` +
          `Use ${formatTokenFieldSelection(foreignKey.targetModel, foreignKey.targetFields)} when the named model token is available in the same contract to keep typed model refs.`,
        {
          code: 'PN_CONTRACT_TYPED_FALLBACK_AVAILABLE',
        },
      );
    }
  }
}

function mapFieldNamesToColumnNames(
  modelName: string,
  fieldNames: readonly string[],
  fieldToColumn: Record<string, string>,
): readonly string[] {
  return fieldNames.map((fieldName) => {
    const columnName = fieldToColumn[fieldName];
    if (!columnName) {
      throw new Error(`Unknown field "${modelName}.${fieldName}" in staged contract definition`);
    }
    return columnName;
  });
}

function resolveInlineIdConstraint(spec: RuntimeModelSpec): IdConstraint | undefined {
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

function resolveModelIdConstraint(spec: RuntimeModelSpec): IdConstraint | undefined {
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
    if (!allSpecs.has(targetModelName)) {
      throw new Error(
        `Relation "${spec.modelName}.${relationName}" references unknown model "${targetModelName}"`,
      );
    }

    foreignKeys.push({
      kind: 'fk',
      fields: normalizeRelationFieldNames(relation.from),
      targetModel: targetModelName,
      targetFields: normalizeRelationFieldNames(relation.to),
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
  const idFields = resolveModelIdConstraint(spec)?.fields;
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
  relation: Extract<StagedRelationState, { kind: 'belongsTo' }>,
  currentSpec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
): SqlSemanticRelationNode {
  const targetModelName = resolveRelationModelName(relation.toModel);
  const targetSpec = allSpecs.get(targetModelName);
  if (!targetSpec) {
    throw new Error(
      `Relation "${currentSpec.modelName}.${relationName}" references unknown model "${targetModelName}"`,
    );
  }

  const fromFields = normalizeRelationFieldNames(relation.from);
  const toFields = normalizeRelationFieldNames(relation.to);

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
  relation: Extract<StagedRelationState, { kind: 'hasMany' | 'hasOne' }>,
  currentSpec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
): SqlSemanticRelationNode {
  const targetModelName = resolveRelationModelName(relation.toModel);
  const targetSpec = allSpecs.get(targetModelName);
  if (!targetSpec) {
    throw new Error(
      `Relation "${currentSpec.modelName}.${relationName}" references unknown model "${targetModelName}"`,
    );
  }

  const parentFields = resolveRelationAnchorFields(currentSpec);
  const childFields = normalizeRelationFieldNames(relation.by);

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
  relation: Extract<StagedRelationState, { kind: 'manyToMany' }>,
  currentSpec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
): SqlSemanticRelationNode {
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
  const throughFromFields = normalizeRelationFieldNames(relation.from);
  const throughToFields = normalizeRelationFieldNames(relation.to);

  return {
    fieldName: relationName,
    toModel: targetModelName,
    toTable: targetSpec.tableName,
    cardinality: 'N:M',
    through: {
      table: throughSpec.tableName,
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

function resolveSemanticRelationNode(
  relationName: string,
  relation: StagedRelationState,
  currentSpec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
): SqlSemanticRelationNode {
  if (relation.kind === 'belongsTo') {
    return lowerBelongsToRelation(relationName, relation, currentSpec, allSpecs);
  }

  if (relation.kind === 'hasMany' || relation.kind === 'hasOne') {
    return lowerHasOwnershipRelation(relationName, relation, currentSpec, allSpecs);
  }

  return lowerManyToManyRelation(relationName, relation, currentSpec, allSpecs);
}

function lowerForeignKeyNode(
  spec: RuntimeModelSpec,
  targetSpec: RuntimeModelSpec,
  foreignKey: {
    readonly fields: readonly string[];
    readonly targetFields: readonly string[];
    readonly name?: string;
    readonly onDelete?: ForeignKeyConstraint['onDelete'];
    readonly onUpdate?: ForeignKeyConstraint['onUpdate'];
    readonly constraint?: boolean;
    readonly index?: boolean;
  },
): SqlSemanticForeignKeyNode {
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

function resolveSemanticForeignKeyNodes(
  spec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
): readonly SqlSemanticForeignKeyNode[] {
  const relationForeignKeys = resolveRelationForeignKeys(spec, allSpecs).map((foreignKey) => {
    const targetSpec = allSpecs.get(foreignKey.targetModel);
    if (!targetSpec) {
      throw new Error(
        `Foreign key on "${spec.modelName}" references unknown model "${foreignKey.targetModel}"`,
      );
    }

    return lowerForeignKeyNode(spec, targetSpec, foreignKey);
  });

  const sqlForeignKeys = (spec.sqlSpec?.foreignKeys ?? []).map((foreignKey) => {
    const targetSpec = allSpecs.get(foreignKey.targetModel);
    if (!targetSpec) {
      throw new Error(
        `Foreign key on "${spec.modelName}" references unknown model "${foreignKey.targetModel}"`,
      );
    }

    return lowerForeignKeyNode(spec, targetSpec, foreignKey);
  });

  return [...relationForeignKeys, ...sqlForeignKeys];
}

function resolveSemanticModelNode(
  spec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
  storageTypes: Record<string, StorageTypeInstance>,
): SqlSemanticModelNode {
  const fields: SqlSemanticFieldNode[] = [];

  for (const [fieldName, fieldBuilder] of Object.entries(spec.fieldBuilders)) {
    const fieldState = fieldBuilder.build();
    const descriptor = resolveFieldDescriptor(spec.modelName, fieldName, fieldState, storageTypes);
    const columnName = spec.fieldToColumn[fieldName];
    if (!columnName) {
      throw new Error(`Column name resolution failed for "${spec.modelName}.${fieldName}"`);
    }

    fields.push({
      fieldName,
      columnName,
      descriptor,
      nullable: fieldState.nullable,
      ...(fieldState.default ? { default: fieldState.default } : {}),
      ...(fieldState.executionDefault ? { executionDefault: fieldState.executionDefault } : {}),
    });
  }

  const idConstraint = resolveModelIdConstraint(spec);
  const uniques = resolveModelUniqueConstraints(spec).map((unique) => ({
    columns: mapFieldNamesToColumnNames(spec.modelName, unique.fields, spec.fieldToColumn),
    ...(unique.name ? { name: unique.name } : {}),
  })) satisfies readonly SqlSemanticUniqueConstraintNode[];
  const indexes = (spec.sqlSpec?.indexes ?? []).map((index) => ({
    columns: mapFieldNamesToColumnNames(spec.modelName, index.fields, spec.fieldToColumn),
    ...(index.name ? { name: index.name } : {}),
    ...(index.using ? { using: index.using } : {}),
    ...(index.config ? { config: index.config } : {}),
  })) satisfies readonly SqlSemanticIndexNode[];
  const foreignKeys = resolveSemanticForeignKeyNodes(spec, allSpecs);
  const relations = Object.entries(spec.relations).map(([relationName, relationBuilder]) =>
    resolveSemanticRelationNode(relationName, relationBuilder.build(), spec, allSpecs),
  );

  return {
    modelName: spec.modelName,
    tableName: spec.tableName,
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
          } satisfies SqlSemanticPrimaryKeyNode,
        }
      : {}),
    ...(uniques.length > 0 ? { uniques } : {}),
    ...(indexes.length > 0 ? { indexes } : {}),
    ...(foreignKeys.length > 0 ? { foreignKeys } : {}),
    ...(relations.length > 0 ? { relations } : {}),
  };
}

function collectRuntimeModelSpecs(definition: StagedContractInput): RuntimeStagedCollection {
  const storageTypes = { ...(definition.types ?? {}) } as Record<string, StorageTypeInstance>;
  const models = { ...(definition.models ?? {}) } as Record<string, RuntimeStagedModel>;

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
    const existingModel = tableOwners.get(tableName);
    if (existingModel) {
      throw new Error(
        `Models "${existingModel}" and "${modelName}" both map to table "${tableName}".`,
      );
    }
    tableOwners.set(tableName, modelName);

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

    modelSpecs.set(modelName, {
      modelName,
      tableName,
      fieldBuilders: modelDefinition.stageOne.fields,
      fieldToColumn,
      relations: modelDefinition.stageOne.relations,
      attributesSpec,
      sqlSpec,
    });
  }

  return {
    storageTypes,
    models,
    modelSpecs,
  };
}

function lowerSemanticModels(collection: RuntimeStagedCollection): readonly SqlSemanticModelNode[] {
  emitTypedCrossModelFallbackWarnings(collection);

  return Array.from(collection.modelSpecs.values()).map((spec) =>
    resolveSemanticModelNode(spec, collection.modelSpecs, collection.storageTypes),
  );
}

export function buildStagedSemanticContractDefinition(
  definition: StagedContractInput,
): SqlSemanticContractDefinition {
  const collection = collectRuntimeModelSpecs(definition);
  const models = lowerSemanticModels(collection);

  return {
    target: definition.target,
    ...(definition.extensionPacks ? { extensionPacks: definition.extensionPacks } : {}),
    ...(definition.capabilities ? { capabilities: definition.capabilities } : {}),
    ...(definition.storageHash ? { storageHash: definition.storageHash } : {}),
    ...(definition.foreignKeyDefaults ? { foreignKeyDefaults: definition.foreignKeyDefaults } : {}),
    ...(Object.keys(collection.storageTypes).length > 0
      ? { storageTypes: collection.storageTypes }
      : {}),
    models,
  };
}
