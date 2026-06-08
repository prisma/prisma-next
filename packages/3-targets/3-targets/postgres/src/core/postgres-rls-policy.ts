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
 * Frozen at construction via `freezeNode(this)`. The `kind: 'postgres-rls-policy'`
 * discriminant is enumerable (overrides SqlNode's non-enumerable `'sql'`) so it
 * survives JSON serialization and enables dispatch.
 */
export class PostgresRlsPolicy extends SqlNode {
  override readonly kind = 'postgres-rls-policy' as const;
  readonly name: string;
  readonly prefix: string;
  readonly tableName: string;
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
    this.operation = input.operation;
    this.roles = Object.freeze([...input.roles]);
    if (input.using !== undefined) this.using = input.using;
    if (input.withCheck !== undefined) this.withCheck = input.withCheck;
    this.permissive = input.permissive;
    freezeNode(this);
  }
}
