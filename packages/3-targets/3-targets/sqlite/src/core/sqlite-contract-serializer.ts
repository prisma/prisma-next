import type { Contract } from '@prisma-next/contract/types';
import { SqlContractSerializerBase } from '@prisma-next/family-sql/ir';
import type { Namespace } from '@prisma-next/framework-components/ir';
import type { SqlNamespaceInput, SqlStorage } from '@prisma-next/sql-contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import type { JsonObject } from '@prisma-next/utils/json';
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
  ): Namespace | SqlNamespaceInput {
    const hydrated = blindCast<
      SqlNamespaceInput,
      'raw is always plain JSON, so super.hydrateSqlNamespaceEntry returns SqlNamespaceInput'
    >(super.hydrateSqlNamespaceEntry(nsId, raw));
    return buildSqliteNamespace(hydrated);
  }

  override serializeContract(contract: Contract<SqlStorage>): JsonObject {
    const { storage, ...rest } = contract;
    const namespacesJson: Record<string, JsonObject> = {};
    for (const [nsId, ns] of Object.entries(storage.namespaces)) {
      namespacesJson[nsId] = {
        id: ns.id,
        entries: this.serializeNamespaceEntries(ns.entries),
      };
    }
    return blindCast<
      JsonObject,
      'rest + storage are serialized plain values; spread preserves JSON-clean contract envelope'
    >({
      ...rest,
      storage: {
        storageHash: String(storage.storageHash),
        namespaces: namespacesJson,
        ...(storage.types !== undefined ? { types: this.serializeJsonObject(storage.types) } : {}),
      },
    });
  }
}
