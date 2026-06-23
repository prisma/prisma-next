import type { DiffableNode } from '@prisma-next/framework-components/control';
import type { EntityCoordinate } from '@prisma-next/framework-components/ir';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlNode } from '@prisma-next/sql-contract/types';

export type RlsPolicyOperation = 'select' | 'insert' | 'update' | 'delete' | 'all';

export interface PostgresRlsPolicyInput {
  /** Full wire name: `<prefix>_<8hex>`. Stored as-is; hashing is not this class's job. */
  readonly name: string;
  /** User-supplied prefix (the part before the `_<8hex>` suffix). */
  readonly prefix: string;
  /** Name of the table this policy attaches to, by name within the same schema. */
  readonly tableName: string;
  /** Namespace coordinate (schema name). Policies are schema-scoped. */
  readonly namespaceId: string;
  readonly operation: RlsPolicyOperation;
  /** Sorted role names rendered in `TO <roles>`. Plain strings in this slice. */
  readonly roles: readonly string[];
  /** USING predicate SQL string, if present. */
  readonly using?: string;
  /** WITH CHECK predicate SQL string, if present. */
  readonly withCheck?: string;
  /** `true` = `AS PERMISSIVE`, `false` = `AS RESTRICTIVE`. */
  readonly permissive: boolean;
}

/**
 * Postgres IR class for a row-level security policy (`CREATE POLICY … ON …`).
 *
 * Target-only concept — no SQL-family abstract. Extends `SqlNode` directly.
 * Frozen at construction via `freezeNode(this)`. The `kind: 'policy'`
 * discriminant is enumerable (overrides SqlNode's non-enumerable `'sql'`) so it
 * survives JSON serialization and enables dispatch. The literal matches the
 * entries key (one-string rule: node.kind === entries key === entity kind).
 */
export class PostgresRlsPolicy extends SqlNode implements DiffableNode {
  override readonly kind = 'policy' as const;
  readonly name: string;
  readonly prefix: string;
  readonly tableName: string;
  readonly namespaceId: string;
  readonly operation: RlsPolicyOperation;
  readonly roles: readonly string[];
  declare readonly using?: string;
  declare readonly withCheck?: string;
  readonly permissive: boolean;

  constructor(input: PostgresRlsPolicyInput) {
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

  identity(): EntityCoordinate {
    return {
      plane: 'storage',
      namespaceId: this.namespaceId,
      entityKind: 'policy',
      entityName: this.name,
    };
  }

  /**
   * Equality by wire name only. The wire name is `<prefix>_<sha256(body)[0..8]>`,
   * so name-equality IS body-equality — two policies with different bodies
   * have different hashes and therefore different names. We deliberately
   * skip comparing bodies directly because Postgres reprints predicate
   * expressions (e.g. strips outer parentheses), so a byte-compare against
   * the authored body would produce false mismatches on a clean re-verify.
   */
  isEqualTo(other: DiffableNode): boolean {
    if (!isPostgresRlsPolicy(other)) {
      throw new Error(
        `PostgresRlsPolicy.isEqualTo: expected a PostgresRlsPolicy, got ${other.identity().entityKind}`,
      );
    }
    return this.name === other.name;
  }
}

export function isPostgresRlsPolicy(node: DiffableNode | undefined): node is PostgresRlsPolicy {
  return node !== undefined && 'kind' in node && node.kind === 'policy';
}

export function assertPostgresRlsPolicy(
  node: DiffableNode | undefined,
): asserts node is PostgresRlsPolicy {
  if (!isPostgresRlsPolicy(node)) {
    const kind = node !== undefined && 'kind' in node ? String(node.kind) : typeof node;
    throw new Error(
      `planRlsDiff: expected a PostgresRlsPolicy on the policy-diff path but got ${kind}`,
    );
  }
}
