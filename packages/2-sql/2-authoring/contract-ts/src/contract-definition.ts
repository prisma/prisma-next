import type {
  ColumnDefault,
  ControlPolicy,
  ExecutionMutationDefaultPhases,
} from '@prisma-next/contract/types';
import type { ForeignKeyDefaultsState } from '@prisma-next/contract-authoring';
import type { ColumnTypeDescriptor } from '@prisma-next/framework-components/codec';
import type { ExtensionPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import type { Namespace } from '@prisma-next/framework-components/ir';
import type {
  PostgresEnumStorageEntry,
  ReferentialAction,
  SqlNamespaceTablesInput,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';

export type { ExecutionMutationDefaultPhases };

export interface FieldNode {
  readonly fieldName: string;
  readonly columnName: string;
  readonly descriptor: ColumnTypeDescriptor;
  readonly nullable: boolean;
  readonly default?: ColumnDefault;
  readonly executionDefaults?: ExecutionMutationDefaultPhases;
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
  readonly type?: string;
  readonly options?: Record<string, unknown>;
}

export interface ForeignKeyNode {
  readonly columns: readonly string[];
  readonly references: {
    readonly model: string;
    readonly table: string;
    readonly columns: readonly string[];
    /**
     * Namespace coordinate of the referenced table. When omitted the
     * assembler resolves the coordinate from the referenced model node's
     * own `namespaceId`; the field exists so authoring paths that already
     * know the target namespace can stamp it explicitly.
     */
    readonly namespaceId?: string;
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
  readonly executionDefaults?: ExecutionMutationDefaultPhases;
  readonly many?: boolean;
}

export interface ValueObjectNode {
  readonly name: string;
  readonly fields: readonly (FieldNode | ValueObjectFieldNode)[];
}

export interface ModelNode {
  readonly modelName: string;
  readonly tableName: string;
  /**
   * Resolved namespace coordinate for this model — the key into the
   * parent contract's `SqlStorage.namespaces` map. Omitting the field
   * (or setting it to the framework's `UNBOUND_NAMESPACE_ID` sentinel)
   * selects the late-bound slot, which renders as unqualified DDL.
   *
   * Populated by per-target PSL interpreters from the resolved
   * `namespace { … }` AST bucket; the TS builder also sets it from the
   * per-model `namespace` field once that authoring surface lands.
   */
  readonly namespaceId?: string;
  readonly fields: readonly (FieldNode | ValueObjectFieldNode)[];
  readonly id?: PrimaryKeyNode;
  readonly uniques?: readonly UniqueConstraintNode[];
  readonly indexes?: readonly IndexNode[];
  readonly foreignKeys?: readonly ForeignKeyNode[];
  readonly relations?: readonly RelationNode[];
  readonly control?: ControlPolicy;
}

export interface ContractDefinition {
  readonly target: TargetPackRef<'sql', string>;
  readonly defaultControlPolicy?: ControlPolicy;
  readonly extensionPacks?: Record<string, ExtensionPackRef<'sql', string>>;
  readonly storageHash?: string;
  readonly foreignKeyDefaults?: ForeignKeyDefaultsState;
  readonly storageTypes?: Record<string, StorageTypeInstance | PostgresEnumStorageEntry>;
  /**
   * Enum types declared inside a named `namespace { enum … }` block,
   * keyed first by namespace id then by type name. These are routed to
   * `storage.namespaces[nsId].enum` rather than the implicit fallback
   * namespace used for top-level `storageTypes` enums.
   */
  readonly namespaceTypes?: Readonly<
    Record<string, Readonly<Record<string, PostgresEnumStorageEntry>>>
  >;
  /**
   * Declared namespace coordinates for this contract — populates
   * `SqlStorage.namespaces` together with `createNamespace`.
   */
  readonly namespaces?: readonly string[];
  /**
   * Target-supplied factory that materialises a `Namespace` concretion
   * for a declared namespace coordinate. Mirrors
   * `ContractInput.createNamespace`.
   */
  readonly createNamespace?: (input: SqlNamespaceTablesInput) => Namespace;
  readonly models: readonly ModelNode[];
  readonly valueObjects?: readonly ValueObjectNode[];
}
