import type { Contract } from '@prisma-next/contract/types';
import type { Namespace } from '@prisma-next/framework-components/ir';
import { createTestSqlNamespace } from '@prisma-next/sql-contract/test-support';
import type { SqlNamespaceInput, SqlStorage } from '@prisma-next/sql-contract/types';
import { SqlContractSerializerBase } from './sql-contract-serializer-base';

/**
 * SQL contract serializer for tests that don't require a target-specific namespace concretion.
 * Uses `TestSqlNamespace` when hydrating namespace entries from plain JSON objects.
 * Production paths always supply a target-specific serializer (e.g. `PostgresContractSerializer`).
 */
export class TestSqlContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
  constructor() {
    super(new Map());
  }

  protected override hydrateSqlNamespaceEntry(
    nsId: string,
    raw: Namespace | Record<string, unknown>,
  ): Namespace | SqlNamespaceInput {
    const result = super.hydrateSqlNamespaceEntry(nsId, raw);
    if ('kind' in result) {
      return result;
    }
    return createTestSqlNamespace(result as SqlNamespaceInput);
  }
}
