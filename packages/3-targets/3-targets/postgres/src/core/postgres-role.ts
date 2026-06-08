import { freezeNode, UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlNode } from '@prisma-next/sql-contract/types';

export interface PostgresRoleInput {
  readonly name: string;
  /**
   * Namespace coordinate. Roles are cluster-scoped (not schema-scoped), so this
   * defaults to `UNBOUND_NAMESPACE_ID`. Stored for structural completeness; the
   * serializer and verifier will read it in later slices.
   */
  readonly namespaceId?: string;
}

/**
 * Postgres IR class for a database role (`CREATE ROLE …`).
 *
 * Roles are cluster-scoped, so their namespace coordinate is always
 * `UNBOUND_NAMESPACE_ID`. Target-only concept — no SQL-family abstract.
 * Extends `SqlNode` directly, frozen at construction via `freezeNode(this)`.
 * The `kind: 'postgres-role'` discriminant is enumerable so it survives JSON.
 */
export class PostgresRole extends SqlNode {
  override readonly kind = 'postgres-role' as const;
  readonly name: string;
  readonly namespaceId: string;

  constructor(input: PostgresRoleInput) {
    super();
    this.name = input.name;
    this.namespaceId = input.namespaceId ?? UNBOUND_NAMESPACE_ID;
    freezeNode(this);
  }
}
