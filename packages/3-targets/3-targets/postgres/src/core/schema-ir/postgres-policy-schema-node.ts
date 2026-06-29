import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
import type { RlsPolicyOperation } from '../postgres-rls-policy';

export interface PostgresPolicySchemaNodeInput {
  /** Full wire name: `<prefix>_<8hex>`. */
  readonly name: string;
  /** User-supplied prefix (the part before the `_<8hex>` suffix). */
  readonly prefix: string;
  /** Name of the table this policy attaches to, by name within the same schema. */
  readonly tableName: string;
  /** Namespace coordinate (schema name). */
  readonly namespaceId: string;
  readonly operation: RlsPolicyOperation;
  /** Sorted role names rendered in `TO <roles>`. */
  readonly roles: readonly string[];
  /** USING predicate SQL string, if present. */
  readonly using?: string;
  /** WITH CHECK predicate SQL string, if present. */
  readonly withCheck?: string;
  /** `true` = `AS PERMISSIVE`, `false` = `AS RESTRICTIVE`. */
  readonly permissive: boolean;
}

/**
 * Schema-diff leaf node for a Postgres row-level security policy.
 *
 * This is a derived, transient node walked by the differ — it is NEVER serialized.
 * Built by project-from-contract and project-from-database from their respective
 * `PostgresRlsPolicy` contract entities / introspected rows.
 *
 * `id` is the wire name (`<prefix>_<sha256(body)[0..8]>`), so name-equality is
 * body-equality. `isEqualTo` compares names only — never byte-compare predicate
 * bodies, because Postgres reprints them.
 */
export class PostgresPolicySchemaNode extends SqlSchemaIRNode implements DiffableNode {
  readonly name: string;
  readonly prefix: string;
  readonly tableName: string;
  readonly namespaceId: string;
  readonly operation: RlsPolicyOperation;
  readonly roles: readonly string[];
  declare readonly using?: string;
  declare readonly withCheck?: string;
  readonly permissive: boolean;

  constructor(input: PostgresPolicySchemaNodeInput) {
    super();
    this.name = input.name;
    this.prefix = input.prefix;
    this.tableName = input.tableName;
    this.namespaceId = input.namespaceId;
    this.operation = input.operation;
    this.roles = Object.freeze([...input.roles]);
    if (input.using !== undefined) this.using = input.using;
    if (input.withCheck !== undefined) this.withCheck = input.withCheck;
    this.permissive = input.permissive;
    freezeNode(this);
  }

  get id(): string {
    return this.name;
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  isEqualTo(other: DiffableNode): boolean {
    if (!PostgresPolicySchemaNode.is(other)) {
      throw new Error(
        `PostgresPolicySchemaNode.isEqualTo: expected a PostgresPolicySchemaNode, got ${other.constructor?.name ?? typeof other}`,
      );
    }
    return this.name === other.name;
  }

  static is(node: DiffableNode): node is PostgresPolicySchemaNode {
    return node instanceof PostgresPolicySchemaNode;
  }
}
