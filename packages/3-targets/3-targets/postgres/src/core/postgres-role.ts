import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlNode } from '@prisma-next/sql-contract/types';

export interface PostgresRoleInput {
  readonly name: string;
  /**
   * Namespace coordinate. Roles are cluster-scoped; pass `UNBOUND_NAMESPACE_ID`
   * from `@prisma-next/framework-components/ir`.
   */
  readonly namespaceId: string;
}

/**
 * Postgres contract-IR class for a database role (`CREATE ROLE …`).
 *
 * This is an authored, serialized Contract-IR entity — it is registered as an entity
 * kind, extends `SqlNode`, and is stored in `contract.json`. It is NOT a DiffableNode;
 * the schema-diff tree uses `PostgresRoleSchemaNode` for that role.
 *
 * Roles are cluster-scoped, so their namespace coordinate is always
 * `UNBOUND_NAMESPACE_ID`. Target-only concept — no SQL-family abstract.
 * Extends `SqlNode` directly, frozen at construction via `freezeNode(this)`.
 * The `kind: 'role'` discriminant is enumerable so it survives JSON.
 * Matches the entries key (one-string rule).
 */
export class PostgresRole extends SqlNode {
  override readonly kind = 'role' as const;
  readonly name: string;
  readonly namespaceId: string;

  constructor(input: PostgresRoleInput) {
    super();
    this.name = input.name;
    this.namespaceId = input.namespaceId;
    freezeNode(this);
  }
}
