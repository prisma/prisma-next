import type { ControlPolicy } from '@prisma-next/contract/types';
import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { assertNode, SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { PostgresNativeEnumSchemaNode } from './postgres-native-enum-schema-node';
import type { PostgresTableSchemaNode } from './postgres-table-schema-node';
import { PostgresSchemaNodeKind } from './schema-node-kinds';

/**
 * One native Postgres enum type carried on a namespace node, member values in
 * `pg_enum.enumsortorder` (declaration) order. `control` is populated only by
 * the expected-side projection (the contract entity's grade); introspection
 * never sets it.
 */
export interface PostgresNativeEnumIntrospection {
  readonly typeName: string;
  readonly values: readonly string[];
  readonly control?: ControlPolicy;
}

export interface PostgresNamespaceSchemaNodeInput {
  readonly schemaName: string;
  readonly tables: Readonly<Record<string, PostgresTableSchemaNode>>;
  /**
   * The enum diff nodes directly — the expected (contract-projected) side
   * passes these, since the diff pairs nodes and nothing reads the plain
   * carrier off an expected node.
   */
  readonly enums?: readonly PostgresNativeEnumSchemaNode[];
  /**
   * The introspection carrier — the actual side passes this; the enum diff
   * nodes are derived from it. Actual-only: `contract infer` and codec
   * `planTypeOperations` hooks read it off the live tree.
   */
  readonly nativeEnums?: readonly PostgresNativeEnumIntrospection[];
  /** The plain type-name list; defaults to the `nativeEnums` type names. */
  readonly nativeEnumTypeNames?: readonly string[];
}

/**
 * One-per-Postgres-schema diff-tree node. Groups the tables belonging to a
 * single namespace. Per-schema consumers (the relational planner,
 * toSchemaView) read this node's `tables` field structurally via
 * `blindCast`/`SqlSchemaIRNode` — not through a static `SqlSchemaIR`
 * assignment — because `nodeKind` carries this node's own literal
 * (`postgres-namespace`), distinct from `SqlSchemaIR`'s own (`sql-schema`).
 *
 * `id` is the schema name; `isEqualTo` is identity on it; `children()` returns
 * the table nodes plus `enums`.
 *
 * `enums` is the diff-tree representation of native enum types the differ
 * pairs. The expected side passes the nodes directly; the actual side passes the
 * introspection carrier (`nativeEnums`/`nativeEnumTypeNames`), which the
 * actual-side readers (`contract infer`, codec hooks) read and from which the
 * enum nodes are derived.
 */
export class PostgresNamespaceSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = PostgresSchemaNodeKind.namespace;

  readonly schemaName: string;
  readonly tables: Readonly<Record<string, PostgresTableSchemaNode>>;
  readonly enums: readonly PostgresNativeEnumSchemaNode[];
  readonly nativeEnums: readonly PostgresNativeEnumIntrospection[];
  readonly nativeEnumTypeNames: readonly string[];

  constructor(input: PostgresNamespaceSchemaNodeInput) {
    super();
    this.schemaName = input.schemaName;
    this.tables = Object.freeze({ ...input.tables });
    this.nativeEnums = Object.freeze(
      (input.nativeEnums ?? []).map((entry) =>
        Object.freeze({
          typeName: entry.typeName,
          values: Object.freeze([...entry.values]),
          ...ifDefined('control', entry.control),
        }),
      ),
    );
    this.nativeEnumTypeNames = Object.freeze([
      ...(input.nativeEnumTypeNames ?? this.nativeEnums.map((entry) => entry.typeName)),
    ]);
    this.enums = Object.freeze(
      input.enums
        ? [...input.enums]
        : this.nativeEnums.map(
            (entry) =>
              new PostgresNativeEnumSchemaNode({
                typeName: entry.typeName,
                namespaceId: input.schemaName,
                members: entry.values,
                ...ifDefined('control', entry.control),
              }),
          ),
    );
    freezeNode(this);
  }

  get id(): string {
    return this.schemaName;
  }

  isEqualTo(other: DiffableNode): boolean {
    return this.id === other.id;
  }

  children(): readonly DiffableNode[] {
    return [...Object.values(this.tables), ...this.enums];
  }

  static is(node: SqlSchemaIRNode): node is PostgresNamespaceSchemaNode {
    return node.nodeKind === PostgresSchemaNodeKind.namespace;
  }

  static assert(node: SqlSchemaIRNode): asserts node is PostgresNamespaceSchemaNode {
    assertNode(node, 'PostgresNamespaceSchemaNode', PostgresNamespaceSchemaNode.is);
  }
}
