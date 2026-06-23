import type { Contract } from '@prisma-next/contract/types';
import { SqlContractSerializerBase } from '@prisma-next/family-sql/ir';
import type { Namespace } from '@prisma-next/framework-components/ir';
import type { SqlNamespaceInput, SqlStorage } from '@prisma-next/sql-contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import { buildSqliteNamespace } from './sqlite-unbound-database';

/**
 * SQLite target `ContractSerializer` concretion. Mirrors the Postgres
 * shape: inherits the full SQL-family deserialization pipeline and
 * materialises namespace entries as SQLite database concretions that
 * expose `qualifyTable()` for runtime SQL rendering.
 */
export class SqliteContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
  constructor() {
    super(new Map());
  }

  protected override hydrateSqlNamespaceEntry(
    nsId: string,
    raw: Namespace | Record<string, unknown>,
  ): Namespace | SqlNamespaceInput {
    const hydrated = blindCast<
      SqlNamespaceInput,
      'super.hydrateSqlNamespaceEntry returns SqlNamespaceInput when raw is not a materialized SqlNamespace'
    >(super.hydrateSqlNamespaceEntry(nsId, raw));
    return buildSqliteNamespace(hydrated);
  }
}
