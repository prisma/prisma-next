import type { ColumnDefault, ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import type {
  ColumnTypeDescriptor,
  ForeignKeyDefaultsState,
} from '@prisma-next/contract-authoring';
import type { ExtensionPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import type { ReferentialAction, StorageTypeInstance } from '@prisma-next/sql-contract/types';

export interface FieldNode {
  readonly fieldName: string;
  readonly columnName: string;
  readonly descriptor: ColumnTypeDescriptor;
  readonly nullable: boolean;
  readonly default?: ColumnDefault;
  readonly executionDefault?: ExecutionMutationDefaultValue;
  readonly many?: boolean;
}

export interface PrimaryKeyNode {
  readonly columns: readonly string[];
  readonly name?: string;
}

export interface UniqueConstraintNode {
  readonly columns: readonly string[];
  readonly name?: string;
}

export interface IndexNode {
  readonly columns: readonly string[];
  readonly name?: string;
  readonly using?: string;
  readonly config?: Record<string, unknown>;
}

export interface ForeignKeyNode {
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

export interface RelationNode {
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

export interface ValueObjectFieldNode {
  readonly fieldName: string;
  readonly columnName: string;
  readonly valueObjectName: string;
  readonly nullable: boolean;
  readonly default?: ColumnDefault;
  readonly executionDefault?: ExecutionMutationDefaultValue;
  readonly many?: boolean;
}

export interface ValueObjectNode {
  readonly name: string;
  readonly fields: readonly (FieldNode | ValueObjectFieldNode)[];
}

export interface ModelNode {
  readonly modelName: string;
  readonly tableName: string;
  readonly fields: readonly (FieldNode | ValueObjectFieldNode)[];
  readonly id?: PrimaryKeyNode;
  readonly uniques?: readonly UniqueConstraintNode[];
  readonly indexes?: readonly IndexNode[];
  readonly foreignKeys?: readonly ForeignKeyNode[];
  readonly relations?: readonly RelationNode[];
}

export interface ContractDefinition {
  readonly target: TargetPackRef<'sql', string>;
  readonly extensionPacks?: Record<string, ExtensionPackRef<'sql', string>>;
  readonly capabilities?: Record<string, Record<string, boolean>>;
  readonly storageHash?: string;
  readonly foreignKeyDefaults?: ForeignKeyDefaultsState;
  readonly storageTypes?: Record<string, StorageTypeInstance>;
  readonly models: readonly ModelNode[];
  readonly valueObjects?: readonly ValueObjectNode[];
}
