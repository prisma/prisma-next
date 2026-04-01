import type { ExtensionPackRef, TargetPackRef } from '@prisma-next/contract/framework-components';
import type { ColumnDefault, ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import type {
  ColumnTypeDescriptor,
  ForeignKeyDefaultsState,
} from '@prisma-next/contract-authoring';
import type { ReferentialAction, StorageTypeInstance } from '@prisma-next/sql-contract/types';

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
