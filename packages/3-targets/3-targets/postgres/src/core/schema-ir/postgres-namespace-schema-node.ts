import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { type SqlSchemaDiffRole, SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
import type { PostgresTableSchemaNode } from './postgres-table-schema-node';
import { PostgresSchemaNodeKind } from './schema-node-kinds';

export interface PostgresNamespaceSchemaNodeInput {
  readonly schemaName: string;
  readonly tables: Readonly<Record<string, PostgresTableSchemaNode>>;
  readonly nativeEnumTypeNames: readonly string[];
}

/**
 * One-per-Postgres-schema diff-tree node. Groups the tables belonging to a
 * single namespace. Per-schema consumers (collectSqlSchemaIssues, the
 * relational planner, toSchemaView) read this node's `tables` field
 * structurally via `blindCast`/`SqlSchemaIRNode` — not through a static
 * `SqlSchemaIR` assignment — because `nodeKind` now carries this node's own
 * literal (`postgres-namespace`), distinct from `SqlSchemaIR`'s own
 * (`sql-schema`).
 *
 * `id` is the schema name. `isEqualTo` is identity — two namespace nodes are
 * equal iff their ids (schema names) match. `children()` returns the table
 * nodes. Per-schema metadata is carried on the typed `nativeEnumTypeNames`
 * field, not an annotations bag.
 */
export class PostgresNamespaceSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = PostgresSchemaNodeKind.namespace;

  override get diffRole(): SqlSchemaDiffRole {
    return 'namespace';
  }
  readonly schemaName: string;
  readonly tables: Readonly<Record<string, PostgresTableSchemaNode>>;
  readonly nativeEnumTypeNames: readonly string[];

  constructor(input: PostgresNamespaceSchemaNodeInput) {
    super();
    this.schemaName = input.schemaName;
    this.tables = Object.freeze({ ...input.tables });
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

  static assert(node: SqlSchemaIRNode): asserts node is PostgresNamespaceSchemaNode {
    if (!PostgresNamespaceSchemaNode.is(node)) {
      throw new Error(
        `Expected a PostgresNamespaceSchemaNode but got nodeKind=${node.nodeKind ?? 'undefined'}`,
      );
    }
  }
}
