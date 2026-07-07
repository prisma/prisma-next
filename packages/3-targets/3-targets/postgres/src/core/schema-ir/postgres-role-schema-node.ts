import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { type SqlSchemaDiffRole, SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import { PostgresSchemaNodeKind } from './schema-node-kinds';

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
  override readonly nodeKind = PostgresSchemaNodeKind.role;

  override get diffRole(): SqlSchemaDiffRole {
    return 'structural';
  }
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
    const node = blindCast<
      SqlSchemaIRNode,
      'every diff-tree node the differ pairs is a SqlSchemaIRNode; the guard rejects non-role kinds'
    >(other);
    PostgresRoleSchemaNode.assert(node);
    return this.id === node.id;
  }

  static is(node: SqlSchemaIRNode): node is PostgresRoleSchemaNode {
    return node.nodeKind === PostgresSchemaNodeKind.role;
  }

  static assert(node: SqlSchemaIRNode): asserts node is PostgresRoleSchemaNode {
    if (!PostgresRoleSchemaNode.is(node)) {
      throw new Error(
        `Expected a PostgresRoleSchemaNode but got nodeKind=${node.nodeKind ?? 'undefined'}`,
      );
    }
  }
}
