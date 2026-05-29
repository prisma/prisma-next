import { asNamespaceId, type NamespaceId } from '@prisma-next/contract/types';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlNode } from './sql-node';

export interface ForeignKeyReferenceInput {
  readonly namespaceId: string;
  readonly tableName: string;
  readonly columns: readonly string[];
}

/**
 * SQL Contract IR node for one side (source or target) of a foreign-key
 * declaration. Carries the full coordinate: namespace, table, and columns.
 *
 * Use `UNBOUND_NAMESPACE_ID` from `@prisma-next/framework-components/ir`
 * as the sentinel `namespaceId` for single-namespace (unbound) references.
 */
export class ForeignKeyReference extends SqlNode {
  readonly namespaceId: NamespaceId;
  readonly tableName: string;
  readonly columns: readonly string[];

  constructor(input: ForeignKeyReferenceInput) {
    super();
    this.namespaceId = asNamespaceId(input.namespaceId);
    this.tableName = input.tableName;
    this.columns = input.columns;
    freezeNode(this);
  }
}
