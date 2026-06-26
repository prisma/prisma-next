import type { DiffableNode } from '@prisma-next/framework-components/control';
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
 * Postgres IR class for a database role (`CREATE ROLE …`).
 *
 * Roles are cluster-scoped, so their namespace coordinate is always
 * `UNBOUND_NAMESPACE_ID`. Target-only concept — no SQL-family abstract.
 * Extends `SqlNode` directly, frozen at construction via `freezeNode(this)`.
 * The `kind: 'role'` discriminant is enumerable so it survives JSON.
 * Matches the entries key (one-string rule).
 */
export class PostgresRole extends SqlNode implements DiffableNode {
  override readonly kind = 'role' as const;
  readonly name: string;
  readonly namespaceId: string;

  constructor(input: PostgresRoleInput) {
    super();
    this.name = input.name;
    this.namespaceId = input.namespaceId;
    freezeNode(this);
  }

  /** Roles are cluster-unique; the name alone is sufficient as a local key. */
  localKey(): string {
    return this.name;
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  isEqualTo(other: DiffableNode): boolean {
    if (!(other instanceof PostgresRole)) {
      throw new Error(
        `PostgresRole.isEqualTo: expected a PostgresRole, got ${other.constructor?.name ?? typeof other}`,
      );
    }
    return this.name === other.name;
  }
}
