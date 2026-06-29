import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';

export interface PostgresRoleSchemaNodeInput {
  readonly name: string;
  /**
   * Namespace coordinate. Roles are cluster-scoped; callers pass
   * `UNBOUND_NAMESPACE_ID` from `@prisma-next/framework-components/ir`.
   */
  readonly namespaceId: string;
}

/**
 * Schema-diff leaf node for a Postgres database role.
 *
 * This is a derived, transient node walked by the differ — it is NEVER serialized.
 * Built by project-from-contract and project-from-database from their respective
 * `PostgresRole` contract entities / introspected rows.
 *
 * Roles are cluster-scoped, so `id` is the role name alone. `isEqualTo` compares
 * names — name-equality is role-equality for cluster-scoped objects.
 */
export class PostgresRoleSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  readonly name: string;
  readonly namespaceId: string;

  constructor(input: PostgresRoleSchemaNodeInput) {
    super();
    this.name = input.name;
    this.namespaceId = input.namespaceId;
    freezeNode(this);
  }

  get id(): string {
    return this.name;
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  isEqualTo(other: DiffableNode): boolean {
    if (!PostgresRoleSchemaNode.is(other)) {
      throw new Error(
        `PostgresRoleSchemaNode.isEqualTo: expected a PostgresRoleSchemaNode, got ${other.constructor?.name ?? typeof other}`,
      );
    }
    return this.name === other.name;
  }

  static is(node: DiffableNode): node is PostgresRoleSchemaNode {
    return node instanceof PostgresRoleSchemaNode;
  }
}
