import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import {
  PostgresNamespaceSchemaNode,
  type PostgresNamespaceSchemaNodeInput,
} from './postgres-namespace-schema-node';
import { PostgresRoleSchemaNode } from './postgres-role-schema-node';
import { PostgresSchemaNodeKind } from './schema-node-kinds';

export interface PostgresDatabaseSchemaNodeInput {
  readonly namespaces: Readonly<
    Record<string, PostgresNamespaceSchemaNode | PostgresNamespaceSchemaNodeInput>
  >;
  readonly roles: readonly (PostgresRoleSchemaNode | { name: string; namespaceId: string })[];
  readonly existingSchemas: readonly string[];
  readonly pgVersion: string;
}

/**
 * The real root of the Postgres schema-diff tree: one node per database.
 *
 * `id` is the fixed sentinel `'database'` — the root has no siblings and
 * the value is never emitted into migration paths. `isEqualTo` is identity
 * (roots always share the `'database'` id). `children()` returns namespace
 * nodes only; roles are held on the root but NOT yielded (role diffing is a
 * later slice, R4).
 *
 * `nodeKind` is an enumerable own discriminant that identifies this node and
 * distinguishes it from the other schema-diff nodes after the `{ ...node }`
 * spread `projectSchemaToSpace` produces.
 */
export class PostgresDatabaseSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = PostgresSchemaNodeKind.database;
  readonly namespaces: Readonly<Record<string, PostgresNamespaceSchemaNode>>;
  readonly roles: readonly PostgresRoleSchemaNode[];
  readonly existingSchemas: readonly string[];
  readonly pgVersion: string;

  constructor(input: PostgresDatabaseSchemaNodeInput) {
    super();
    // Reconstruct namespace/role nodes from plain objects: `projectSchemaToSpace`
    // spreads the tree into plain objects (losing prototypes) before this root
    // is `ensure`d, so the differ must still see real `DiffableNode`s.
    this.namespaces = Object.freeze(
      Object.fromEntries(
        Object.entries(input.namespaces).map(([key, ns]) => [
          key,
          ns instanceof PostgresNamespaceSchemaNode ? ns : new PostgresNamespaceSchemaNode(ns),
        ]),
      ),
    );
    this.roles = Object.freeze(
      input.roles.map((r) =>
        r instanceof PostgresRoleSchemaNode ? r : new PostgresRoleSchemaNode(r),
      ),
    );
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
    return Object.values(this.namespaces);
  }

  static is(node: SqlSchemaIRNode): node is PostgresDatabaseSchemaNode {
    return node.nodeKind === PostgresSchemaNodeKind.database;
  }

  static assert(node: SqlSchemaIRNode): asserts node is PostgresDatabaseSchemaNode {
    if (!PostgresDatabaseSchemaNode.is(node)) {
      throw new Error(
        `Expected a PostgresDatabaseSchemaNode but got nodeKind=${node.nodeKind ?? 'undefined'}`,
      );
    }
  }

  /**
   * Returns `node` as-is when it is a real instance, or reconstructs one when
   * `projectSchemaToSpace` has spread the class into a plain object (losing
   * prototype methods but preserving all own-enumerable fields).
   */
  static ensure(node: SqlSchemaIRNode): PostgresDatabaseSchemaNode {
    if (node instanceof PostgresDatabaseSchemaNode) return node;
    return new PostgresDatabaseSchemaNode(
      blindCast<
        PostgresDatabaseSchemaNodeInput,
        'spread objects from projectSchemaToSpace preserve all own-enumerable fields'
      >(node),
    );
  }
}
