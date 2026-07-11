import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { assertNode, SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
import type { PostgresNamespaceSchemaNode } from './postgres-namespace-schema-node';
import type { PostgresRoleSchemaNode } from './postgres-role-schema-node';
import { PostgresSchemaNodeKind } from './schema-node-kinds';

export interface PostgresDatabaseSchemaNodeInput {
  readonly namespaces: Readonly<Record<string, PostgresNamespaceSchemaNode>>;
  readonly roles: readonly PostgresRoleSchemaNode[];
  readonly existingSchemas: readonly string[];
  readonly pgVersion: string;
}

/**
 * The root of the Postgres schema-diff tree: one node per database.
 *
 * `id` is the fixed sentinel `'database'` — the root has no siblings and
 * the value is never emitted into migration paths. `isEqualTo` is identity
 * (roots always share the `'database'` id). `children()` yields the namespace
 * nodes followed by the role nodes — both are root-level diff subjects. Role
 * ids carry a `role:` sigil so they never collide with a same-named namespace
 * in the differ's flat sibling map.
 */
export class PostgresDatabaseSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = PostgresSchemaNodeKind.database;

  readonly namespaces: Readonly<Record<string, PostgresNamespaceSchemaNode>>;
  readonly roles: readonly PostgresRoleSchemaNode[];
  readonly existingSchemas: readonly string[];
  readonly pgVersion: string;

  constructor(input: PostgresDatabaseSchemaNodeInput) {
    super();
    this.namespaces = Object.freeze({ ...input.namespaces });
    this.roles = Object.freeze([...input.roles]);
    this.existingSchemas = Object.freeze([...input.existingSchemas]);
    this.pgVersion = input.pgVersion;
    freezeNode(this);
  }

  get id(): string {
    return 'database';
  }

  isEqualTo(other: DiffableNode): boolean {
    return this.id === other.id;
  }

  children(): readonly DiffableNode[] {
    return [...Object.values(this.namespaces), ...this.roles];
  }

  static is(node: SqlSchemaIRNode): node is PostgresDatabaseSchemaNode {
    return node.nodeKind === PostgresSchemaNodeKind.database;
  }

  static assert(node: SqlSchemaIRNode): asserts node is PostgresDatabaseSchemaNode {
    assertNode(node, 'PostgresDatabaseSchemaNode', PostgresDatabaseSchemaNode.is);
  }
}
