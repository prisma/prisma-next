import type { Contract } from '@prisma-next/contract/types';
import { SqlContractSerializerBase } from '@prisma-next/family-sql/ir';
import type { SqlNamespaceTablesInput, SqlStorage } from '@prisma-next/sql-contract/types';
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
    raw: Record<string, unknown>,
  ): SqlNamespaceTablesInput {
    return buildSqliteNamespace(super.hydrateSqlNamespaceEntry(nsId, raw));
  }
}
