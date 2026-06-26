import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlNode } from '@prisma-next/sql-contract/types';
import type { PostgresRlsPolicy } from './postgres-rls-policy';

export interface PostgresTableNodeInput {
  readonly schemaName: string;
  readonly tableName: string;
  readonly policies: readonly PostgresRlsPolicy[];
}

/**
 * Groups RLS policies for one (schema, table) pair into a single diffable node.
 * Sits between `PostgresSchemaIR` (database root) and `PostgresRlsPolicy` (leaf)
 * in the diff tree, so same-wire-name policies on different tables stay distinct.
 *
 * `isEqualTo` is always true — no table-level attributes are diffed yet.
 * Missing/extra issues for this node are dropped by the caller's whitelist;
 * only policy-subject issues reach the planner.
 */
export class PostgresTableNode extends SqlNode implements DiffableNode {
  override readonly kind = 'table-node' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly policies: readonly PostgresRlsPolicy[];

  constructor(input: PostgresTableNodeInput) {
    super();
    this.schemaName = input.schemaName;
    this.tableName = input.tableName;
    this.policies = Object.freeze([...input.policies]);
    freezeNode(this);
  }

  id(): string {
    return `${this.schemaName}/${this.tableName}`;
  }

  isEqualTo(_other: DiffableNode): boolean {
    return true;
  }

  children(): readonly DiffableNode[] {
    return this.policies;
  }
}

export function isPostgresTableNode(node: DiffableNode | undefined): node is PostgresTableNode {
  return node !== undefined && 'kind' in node && node.kind === 'table-node';
}
