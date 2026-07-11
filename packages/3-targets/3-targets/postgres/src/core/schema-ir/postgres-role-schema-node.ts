import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { assertNode, SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
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
 * The `id` sigil that namespaces a role away from schema/namespace ids.
 *
 * Roles are root-level siblings of namespace nodes, and the differ keys a
 * parent's children into one flat `id → node` map that throws on a duplicate
 * id. A role and a schema may share a name (role `public`, schema `public`),
 * so a role's diff id carries this prefix, which no namespace id can equal.
 * The bare role name is still available via {@link PostgresRoleSchemaNode.name}
 * for diagnostics.
 */
const ROLE_ID_SIGIL = 'role:';

/**
 * Schema-diff leaf node for a Postgres database role.
 *
 * This is a derived, transient node walked by the differ — it is NEVER serialized.
 * Built by project-from-contract and project-from-database from their respective
 * `PostgresRole` contract entities / introspected rows.
 *
 * Roles are cluster-scoped, so `id` is the role name under a `role:` sigil
 * (see {@link ROLE_ID_SIGIL}). `isEqualTo` compares ids — name-equality is
 * role-equality for cluster-scoped objects.
 */
export class PostgresRoleSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = PostgresSchemaNodeKind.role;

  readonly name: string;
  readonly namespaceId: string;

  constructor(input: PostgresRoleSchemaNodeInput) {
    super();
    this.name = input.name;
    this.namespaceId = input.namespaceId;
    freezeNode(this);
  }

  get id(): string {
    return `${ROLE_ID_SIGIL}${this.name}`;
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
    assertNode(node, 'PostgresRoleSchemaNode', PostgresRoleSchemaNode.is);
  }
}
