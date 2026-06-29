import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlSchemaIRNode, type SqlSchemaTarget } from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import {
  PostgresNamespaceSchemaNode,
  type PostgresNamespaceSchemaNodeInput,
} from './postgres-namespace-schema-node';
import { PostgresRoleSchemaNode } from './postgres-role-schema-node';

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
 * the value is never emitted into migration paths. `isEqualTo` is always
 * true. `children()` returns namespace nodes only; roles are held on the
 * root but NOT yielded (role diffing is a later slice, R4).
 *
 * `nodeTarget = 'postgres'` is an enumerable own field so it survives the
 * `{ ...node }` spread that `projectSchemaToSpace` produces. `nodeKind` is
 * a second enumerable discriminant that distinguishes the database root
 * from `PostgresNamespaceSchemaNode` (which also carries `nodeTarget =
 * 'postgres'`) after a spread.
 */
export class PostgresDatabaseSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  readonly nodeTarget: SqlSchemaTarget = 'postgres';
  readonly nodeKind = 'postgres-database' as const;
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

  isEqualTo(_other: DiffableNode): boolean {
    return true;
  }

  children(): readonly DiffableNode[] {
    return Object.values(this.namespaces);
  }

  static is(node: unknown): node is PostgresDatabaseSchemaNode {
    if (node instanceof PostgresDatabaseSchemaNode) return true;
    if (typeof node !== 'object' || node === null) return false;
    const n = blindCast<
      Record<string, unknown>,
      'narrowed to a non-null object; reading enumerable own discriminants that survive the projectSchemaToSpace spread'
    >(node);
    return n['nodeTarget'] === 'postgres' && n['nodeKind'] === 'postgres-database';
  }

  static assert(node: unknown): asserts node is PostgresDatabaseSchemaNode {
    if (!PostgresDatabaseSchemaNode.is(node)) {
      const target =
        typeof node === 'object' && node !== null
          ? String(
              blindCast<
                Record<string, unknown>,
                'narrowed to a non-null object; reading the nodeTarget discriminant for the error message'
              >(node)['nodeTarget'] ?? typeof node,
            )
          : typeof node;
      throw new Error(`Expected a PostgresDatabaseSchemaNode but got nodeTarget=${target}`);
    }
  }

  /**
   * Returns `node` as-is when it is a real instance, or reconstructs one when
   * `projectSchemaToSpace` has spread the class into a plain object (losing
   * prototype methods but preserving all own-enumerable fields).
   */
  static ensure(node: PostgresDatabaseSchemaNode): PostgresDatabaseSchemaNode {
    if (node instanceof PostgresDatabaseSchemaNode) return node;
    return new PostgresDatabaseSchemaNode(
      blindCast<
        PostgresDatabaseSchemaNodeInput,
        'spread objects from projectSchemaToSpace preserve all own-enumerable fields'
      >(node),
    );
  }
}
