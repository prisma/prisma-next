import type {
  ColumnDefault,
  ControlPolicy,
  ExecutionMutationDefaultPhases,
} from '@prisma-next/contract/types';
import type { ForeignKeyDefaultsState } from '@prisma-next/contract-authoring';
import type { ColumnTypeDescriptor } from '@prisma-next/framework-components/codec';
import type { ExtensionPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import type {
  ReferentialAction,
  SqlNamespace,
  SqlNamespaceInput,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import type { EnumTypeHandle } from './enum-type';

export type { ExecutionMutationDefaultPhases };

export interface FieldNode {
  readonly fieldName: string;
  readonly columnName: string;
  readonly descriptor: ColumnTypeDescriptor;
  readonly nullable: boolean;
  readonly default?: ColumnDefault;
  readonly executionDefaults?: ExecutionMutationDefaultPhases;
  readonly many?: boolean;
  /** Present when the field was authored with `field.namedType(enumHandle)`. */
  readonly enumTypeHandle?: EnumTypeHandle;
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
    /**
     * Contract-space identity of the referenced table. When present, the
     * table lives in a different contract space (identified by this value)
     * rather than the current contract. Absent for local FKs.
     */
    readonly spaceId?: string;
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
  /**
   * Namespace coordinate of the related model. When omitted the assembler
   * resolves the coordinate from the referenced model node's own
   * `namespaceId`; the field exists so authoring paths that already know the
   * target namespace can stamp it explicitly — required to disambiguate a
   * relation to a model whose bare name also exists in another namespace.
   */
  readonly toNamespaceId?: string;
  readonly cardinality: '1:1' | '1:N' | 'N:1' | 'N:M';
  /**
   * Contract-space identity of the related model. When present, the
   * related model lives in a different contract space. Absent for local
   * (same-space) relations.
   */
  readonly spaceId?: string;
  /**
   * Namespace coordinate of the related model in the foreign space.
   * Only set when `spaceId` is present.
   */
  readonly namespaceId?: string;
  readonly on: {
    readonly parentTable: string;
    readonly parentColumns: readonly string[];
    readonly childTable: string;
    readonly childColumns: readonly string[];
  };
  readonly through?: {
    readonly table: string;
    /**
     * Namespace the junction table lives in. Set from the junction model's
     * declared namespace at lowering time; junction table names are unique per
     * namespace, not globally, so this disambiguates a junction whose bare table
     * name also exists in another namespace. Omitted for a junction in the
     * default namespace (resolved to the target's default at build time).
     */
    readonly namespaceId?: string;
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
  /**
   * Single-table-inheritance variants share their base model's storage table:
   * the variant's columns are materialised onto the base `ModelNode`, and this
   * model contributes a domain model but no storage table of its own. When set,
   * the assembler builds the domain model but skips creating a (shadow) storage
   * table and a root for this model — the base owns both.
   */
  readonly sharesBaseTable?: boolean;
}

export interface ContractDefinition {
  readonly target: TargetPackRef<'sql', string>;
  readonly defaultControlPolicy?: ControlPolicy;
  readonly extensionPacks?: Record<string, ExtensionPackRef<'sql', string>>;
  readonly storageHash?: string;
  readonly foreignKeyDefaults?: ForeignKeyDefaultsState;
  readonly storageTypes?: Record<string, StorageTypeInstance>;
  /**
   * Declared namespace coordinates for this contract — populates
   * `SqlStorage.namespaces` together with `createNamespace`.
   */
  readonly namespaces?: readonly string[];
  /** Target-supplied factory that materialises a `SqlNamespace` concretion for a declared namespace coordinate. */
  readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespace;
  readonly models: readonly ModelNode[];
  readonly valueObjects?: readonly ValueObjectNode[];
  /**
   * Domain enum handles authored via `enumType()`. Each entry lowers to a
   * domain `enum` entry and a storage `valueSet` entry in the contract's
   * default namespace.
   */
  readonly enums?: Record<string, EnumTypeHandle>;
}
