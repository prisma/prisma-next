import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
import {
  PostgresTableSchemaNode,
  type PostgresTableSchemaNodeInput,
} from './postgres-table-schema-node';
import { PostgresSchemaNodeKind } from './schema-node-kinds';

export interface PostgresNamespaceSchemaNodeInput {
  readonly schemaName: string;
  readonly tables: Readonly<Record<string, PostgresTableSchemaNode | PostgresTableSchemaNodeInput>>;
  readonly nativeEnumTypeNames: readonly string[];
}

/**
 * One-per-Postgres-schema diff-tree node. Groups the tables belonging to a
 * single namespace and satisfies the `SqlSchemaIR` shape so legacy per-schema
 * consumers (verifySqlSchema, the relational planner, toSchemaView) can
 * accept it unchanged in Unit 6.
 *
 * `id` is the schema name. `isEqualTo` is identity — two namespace nodes are
 * equal iff their ids (schema names) match. `children()` returns the table
 * nodes. Per-schema metadata is carried on the typed `nativeEnumTypeNames`
 * field, not an annotations bag.
 */
export class PostgresNamespaceSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = PostgresSchemaNodeKind.namespace;
  readonly schemaName: string;
  readonly tables: Readonly<Record<string, PostgresTableSchemaNode>>;
  readonly nativeEnumTypeNames: readonly string[];

  constructor(input: PostgresNamespaceSchemaNodeInput) {
    super();
    this.schemaName = input.schemaName;
    // Reconstruct table nodes from plain objects: `projectSchemaToSpace`
    // spreads the tree into plain objects before a consumer `ensure`s the root.
    this.tables = Object.freeze(
      Object.fromEntries(
        Object.entries(input.tables).map(([key, t]) => [
          key,
          t instanceof PostgresTableSchemaNode ? t : new PostgresTableSchemaNode(t),
        ]),
      ),
    );
    this.nativeEnumTypeNames = Object.freeze([...input.nativeEnumTypeNames]);
    freezeNode(this);
  }

  get id(): string {
    return this.schemaName;
  }

  isEqualTo(other: DiffableNode): boolean {
    return this.id === other.id;
  }

  children(): readonly DiffableNode[] {
    return Object.values(this.tables);
  }

  static is(node: SqlSchemaIRNode): node is PostgresNamespaceSchemaNode {
    return node.nodeKind === PostgresSchemaNodeKind.namespace;
  }
}
