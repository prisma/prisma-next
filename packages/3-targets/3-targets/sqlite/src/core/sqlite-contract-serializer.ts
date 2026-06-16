import type { Contract } from '@prisma-next/contract/types';
import { SqlContractSerializerBase } from '@prisma-next/family-sql/ir';
import { type Namespace, NamespaceBase } from '@prisma-next/framework-components/ir';
import type { SqlNamespaceTablesInput, SqlStorage } from '@prisma-next/sql-contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import { sqliteTargetDescriptorMeta } from './descriptor-meta';
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

  protected override get defaultNamespaceId(): string {
    return sqliteTargetDescriptorMeta.defaultNamespaceId;
  }

  protected override hydrateSqlNamespaceEntry(
    nsId: string,
    raw: Namespace | Record<string, unknown>,
  ): Namespace | SqlNamespaceTablesInput {
    if (raw instanceof NamespaceBase) {
      return raw;
    }
    const hydrated = blindCast<
      SqlNamespaceTablesInput,
      'super.hydrateSqlNamespaceEntry returns the tables form when raw is not a NamespaceBase'
    >(super.hydrateSqlNamespaceEntry(nsId, raw));
    return buildSqliteNamespace(hydrated);
  }
}
