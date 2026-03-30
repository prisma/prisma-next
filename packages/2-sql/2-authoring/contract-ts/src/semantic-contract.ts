import type { ExtensionPackRef, TargetPackRef } from '@prisma-next/contract/framework-components';
import type { ContractIR } from '@prisma-next/contract/ir';
import type { ColumnDefault, ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import type {
  ColumnTypeDescriptor,
  ForeignKeyDefaultsState,
  ReferentialAction,
} from '@prisma-next/contract-authoring';
import type { StorageTypeInstance } from '@prisma-next/sql-contract/types';

export interface SqlSemanticFieldNode {
  readonly fieldName: string;
  readonly columnName: string;
  readonly descriptor: ColumnTypeDescriptor;
  readonly nullable: boolean;
  readonly default?: ColumnDefault;
  readonly executionDefault?: ExecutionMutationDefaultValue;
}

export interface SqlSemanticPrimaryKeyNode {
  readonly columns: readonly string[];
  readonly name?: string;
}

export interface SqlSemanticUniqueConstraintNode {
  readonly columns: readonly string[];
  readonly name?: string;
}

export interface SqlSemanticIndexNode {
  readonly columns: readonly string[];
  readonly name?: string;
  readonly using?: string;
  readonly config?: Record<string, unknown>;
}

export interface SqlSemanticForeignKeyNode {
  readonly columns: readonly string[];
  readonly references: {
    readonly model: string;
    readonly table: string;
    readonly columns: readonly string[];
  };
  readonly name?: string;
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
  readonly constraint?: boolean;
  readonly index?: boolean;
}

export interface SqlSemanticRelationNode {
  readonly fieldName: string;
  readonly toModel: string;
  readonly toTable: string;
  readonly cardinality: '1:1' | '1:N' | 'N:1' | 'N:M';
  readonly on: {
    readonly parentTable: string;
    readonly parentColumns: readonly string[];
    readonly childTable: string;
    readonly childColumns: readonly string[];
  };
  readonly through?: {
    readonly table: string;
    readonly parentColumns: readonly string[];
    readonly childColumns: readonly string[];
  };
}

export interface SqlSemanticModelNode {
  readonly modelName: string;
  readonly tableName: string;
  readonly fields: readonly SqlSemanticFieldNode[];
  readonly id?: SqlSemanticPrimaryKeyNode;
  readonly uniques?: readonly SqlSemanticUniqueConstraintNode[];
  readonly indexes?: readonly SqlSemanticIndexNode[];
  readonly foreignKeys?: readonly SqlSemanticForeignKeyNode[];
  readonly relations?: readonly SqlSemanticRelationNode[];
}

export interface SqlSemanticContractDefinition {
  readonly target: TargetPackRef<'sql', string>;
  readonly extensionPacks?: Record<string, ExtensionPackRef<'sql', string>>;
  readonly capabilities?: Record<string, Record<string, boolean>>;
  readonly storageHash?: string;
  readonly foreignKeyDefaults?: ForeignKeyDefaultsState;
  readonly storageTypes?: Record<string, StorageTypeInstance>;
  readonly models: readonly SqlSemanticModelNode[];
}

export interface SqlSemanticTableBuilderLike {
  column(
    name: string,
    options: {
      readonly type: ColumnTypeDescriptor;
      readonly nullable?: true;
      readonly default?: ColumnDefault;
    },
  ): SqlSemanticTableBuilderLike;
  generated(
    name: string,
    options: {
      readonly type: ColumnTypeDescriptor;
      readonly generated: ExecutionMutationDefaultValue;
    },
  ): SqlSemanticTableBuilderLike;
  unique(columns: readonly string[], name?: string): SqlSemanticTableBuilderLike;
  primaryKey(columns: readonly string[], name?: string): SqlSemanticTableBuilderLike;
  index(
    columns: readonly string[],
    options?: {
      readonly name?: string;
      readonly using?: string;
      readonly config?: Record<string, unknown>;
    },
  ): SqlSemanticTableBuilderLike;
  foreignKey(
    columns: readonly string[],
    references: { readonly table: string; readonly columns: readonly string[] },
    options?: {
      readonly name?: string;
      readonly onDelete?: ReferentialAction;
      readonly onUpdate?: ReferentialAction;
      readonly constraint?: boolean;
      readonly index?: boolean;
    },
  ): SqlSemanticTableBuilderLike;
}

export interface SqlSemanticModelBuilderLike {
  field(fieldName: string, columnName: string): SqlSemanticModelBuilderLike;
  relation(
    name: string,
    options:
      | {
          readonly toModel: string;
          readonly toTable: string;
          readonly cardinality: '1:1' | '1:N' | 'N:1';
          readonly on: {
            readonly parentTable: string;
            readonly parentColumns: readonly string[];
            readonly childTable: string;
            readonly childColumns: readonly string[];
          };
        }
      | {
          readonly toModel: string;
          readonly toTable: string;
          readonly cardinality: 'N:M';
          readonly through: {
            readonly table: string;
            readonly parentColumns: readonly string[];
            readonly childColumns: readonly string[];
          };
          readonly on: {
            readonly parentTable: string;
            readonly parentColumns: readonly string[];
            readonly childTable: string;
            readonly childColumns: readonly string[];
          };
        },
  ): SqlSemanticModelBuilderLike;
}

export interface SqlSemanticContractBuilderLike {
  target(target: TargetPackRef<'sql', string>): SqlSemanticContractBuilderLike;
  extensionPacks(
    packs: Record<string, ExtensionPackRef<'sql', string>>,
  ): SqlSemanticContractBuilderLike;
  capabilities(
    capabilities: Record<string, Record<string, boolean>>,
  ): SqlSemanticContractBuilderLike;
  storageHash(hash: string): SqlSemanticContractBuilderLike;
  foreignKeyDefaults(config: ForeignKeyDefaultsState): SqlSemanticContractBuilderLike;
  storageType(name: string, typeInstance: StorageTypeInstance): SqlSemanticContractBuilderLike;
  table(
    name: string,
    callback: (tableBuilder: SqlSemanticTableBuilderLike) => SqlSemanticTableBuilderLike,
  ): SqlSemanticContractBuilderLike;
  model(
    name: string,
    table: string,
    callback: (modelBuilder: SqlSemanticModelBuilderLike) => SqlSemanticModelBuilderLike,
  ): SqlSemanticContractBuilderLike;
  build(): ContractIR;
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

function appendSemanticFields(
  tableBuilder: SqlSemanticTableBuilderLike,
  model: SqlSemanticModelNode,
): SqlSemanticTableBuilderLike {
  let next = tableBuilder;

  for (const field of model.fields) {
    if (field.executionDefault) {
      next = next.generated(field.columnName, {
        type: field.descriptor,
        generated: field.executionDefault,
      });
      continue;
    }

    next = next.column(field.columnName, {
      type: field.descriptor,
      ...(field.nullable ? { nullable: true as const } : {}),
      ...(field.default ? { default: field.default } : {}),
    });
  }

  return next;
}

function appendSemanticConstraints(
  tableBuilder: SqlSemanticTableBuilderLike,
  model: SqlSemanticModelNode,
  modelsByName: ReadonlyMap<string, SqlSemanticModelNode>,
): SqlSemanticTableBuilderLike {
  let next = tableBuilder;

  if (model.id) {
    next = next.primaryKey(model.id.columns, model.id.name);
  }

  for (const unique of model.uniques ?? []) {
    next = next.unique(unique.columns, unique.name);
  }

  for (const index of model.indexes ?? []) {
    next = next.index(index.columns, {
      ...(index.name ? { name: index.name } : {}),
      ...(index.using ? { using: index.using } : {}),
      ...(index.config ? { config: index.config } : {}),
    });
  }

  for (const foreignKey of model.foreignKeys ?? []) {
    const targetModel = assertKnownTargetModel(
      modelsByName,
      model.modelName,
      foreignKey.references.model,
      'Foreign key',
    );
    assertTargetTableMatches(
      model.modelName,
      targetModel,
      foreignKey.references.table,
      'Foreign key',
    );

    next = next.foreignKey(
      foreignKey.columns,
      {
        table: foreignKey.references.table,
        columns: foreignKey.references.columns,
      },
      {
        ...(foreignKey.name ? { name: foreignKey.name } : {}),
        ...(foreignKey.onDelete ? { onDelete: foreignKey.onDelete } : {}),
        ...(foreignKey.onUpdate ? { onUpdate: foreignKey.onUpdate } : {}),
        ...(foreignKey.constraint !== undefined ? { constraint: foreignKey.constraint } : {}),
        ...(foreignKey.index !== undefined ? { index: foreignKey.index } : {}),
      },
    );
  }

  return next;
}

function appendSemanticRelations(
  modelBuilder: SqlSemanticModelBuilderLike,
  model: SqlSemanticModelNode,
  modelsByName: ReadonlyMap<string, SqlSemanticModelNode>,
): SqlSemanticModelBuilderLike {
  let next = modelBuilder;

  for (const field of model.fields) {
    next = next.field(field.fieldName, field.columnName);
  }

  for (const relation of model.relations ?? []) {
    const targetModel = assertKnownTargetModel(
      modelsByName,
      model.modelName,
      relation.toModel,
      'Relation',
    );
    assertTargetTableMatches(model.modelName, targetModel, relation.toTable, 'Relation');

    if (relation.cardinality === 'N:M') {
      if (!relation.through) {
        throw new Error(
          `Relation "${model.modelName}.${relation.fieldName}" with cardinality "N:M" requires through metadata`,
        );
      }

      next = next.relation(relation.fieldName, {
        toModel: relation.toModel,
        toTable: relation.toTable,
        cardinality: 'N:M',
        through: relation.through,
        on: relation.on,
      });
      continue;
    }

    next = next.relation(relation.fieldName, {
      toModel: relation.toModel,
      toTable: relation.toTable,
      cardinality: relation.cardinality,
      on: relation.on,
    });
  }

  return next;
}

export function buildSemanticSqlContract(
  definition: SqlSemanticContractDefinition,
  createBuilder: () => SqlSemanticContractBuilderLike,
): ContractIR {
  const modelsByName = new Map(definition.models.map((model) => [model.modelName, model]));

  let builder = createBuilder().target(definition.target);

  if (definition.extensionPacks) {
    builder = builder.extensionPacks(definition.extensionPacks);
  }

  if (definition.capabilities) {
    builder = builder.capabilities(definition.capabilities);
  }

  if (definition.storageHash) {
    builder = builder.storageHash(definition.storageHash);
  }

  if (definition.foreignKeyDefaults) {
    builder = builder.foreignKeyDefaults(definition.foreignKeyDefaults);
  }

  for (const [typeName, storageType] of Object.entries(definition.storageTypes ?? {})) {
    builder = builder.storageType(typeName, storageType);
  }

  for (const model of definition.models) {
    builder = builder.table(model.tableName, (tableBuilder) =>
      appendSemanticConstraints(appendSemanticFields(tableBuilder, model), model, modelsByName),
    );
  }

  for (const model of definition.models) {
    builder = builder.model(model.modelName, model.tableName, (modelBuilder) =>
      appendSemanticRelations(modelBuilder, model, modelsByName),
    );
  }

  return builder.build();
}
