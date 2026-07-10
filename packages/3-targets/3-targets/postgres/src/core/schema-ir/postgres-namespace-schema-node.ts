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
  readonly nativeEnumTypeNames: readonly string[];
  readonly nativeEnums?: readonly PostgresNativeEnumIntrospection[];
}

/**
 * One-per-Postgres-schema diff-tree node. Groups the tables belonging to a
 * single namespace. Per-schema consumers (the relational planner,
 * toSchemaView) read this node's `tables` field structurally via
 * `blindCast`/`SqlSchemaIRNode` — not through a static `SqlSchemaIR`
 * assignment — because `nodeKind` now carries this node's own literal
 * (`postgres-namespace`), distinct from `SqlSchemaIR`'s own (`sql-schema`).
 *
 * `id` is the schema name. `isEqualTo` is identity — two namespace nodes are
 * equal iff their ids (schema names) match. `children()` returns the table
 * nodes. Per-schema metadata is carried on the typed `nativeEnumTypeNames`
 * field, not an annotations bag.
 *
 * `nativeEnums` carries the same enum types with their ordered member
 * values (`{ typeName, values }`), for consumers that need the values
 * (PSL inference, the printer). `nativeEnumTypeNames` stays a plain name
 * list read independently by existing consumers (codec `planTypeOperations`
 * hooks, the infer throw) so none of them need the values to keep working.
 *
 * `enums` is the diff-tree face of the same data: one derived
 * `PostgresNativeEnumSchemaNode` per `nativeEnums` entry, exposed through
 * `children()` alongside the tables. Both sides derive symmetrically —
 * whichever projection populated `nativeEnums` (contract entities or
 * introspection) gets its enum nodes paired by the differ.
 */
export class PostgresNamespaceSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = PostgresSchemaNodeKind.namespace;

  readonly schemaName: string;
  readonly tables: Readonly<Record<string, PostgresTableSchemaNode>>;
  readonly nativeEnumTypeNames: readonly string[];
  readonly nativeEnums: readonly PostgresNativeEnumIntrospection[];
  readonly enums: readonly PostgresNativeEnumSchemaNode[];

  constructor(input: PostgresNamespaceSchemaNodeInput) {
    super();
    this.schemaName = input.schemaName;
    this.tables = Object.freeze({ ...input.tables });
    this.nativeEnumTypeNames = Object.freeze([...input.nativeEnumTypeNames]);
    this.nativeEnums = Object.freeze(
      (input.nativeEnums ?? []).map((entry) =>
        Object.freeze({
          typeName: entry.typeName,
          values: Object.freeze([...entry.values]),
          ...ifDefined('control', entry.control),
        }),
      ),
    );
    this.enums = Object.freeze(
      this.nativeEnums.map(
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
