import type { Contract } from '@prisma-next/contract/types';
import {
  SqlContractSerializerBase,
  type SqlNamespaceSlotHydrationFactory,
} from '@prisma-next/family-sql/ir';
import {
  type Namespace,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import {
  type SqlNamespaceTablesInput,
  type SqlStorage,
  StorageTable,
  type StorageTableInput,
} from '@prisma-next/sql-contract/types';
import type { JsonObject } from '@prisma-next/utils/json';
import { PostgresEnumType, type PostgresEnumTypeInput } from './postgres-enum-type';
import { isPostgresSchema, PostgresSchema } from './postgres-schema';

/**
 * Hydration factory for the per-namespace enum slot. Pre-extracted as
 * a module-level binding so the family-base registry receives a stable
 * reference and the same callable shape is reused when the descriptor
 * mechanism takes over the registration (S1.A D5).
 */
const hydratePostgresEnumType: SqlNamespaceSlotHydrationFactory = (raw) => {
  if (raw instanceof PostgresEnumType) {
    return raw;
  }
  const plain = raw as Record<string, unknown>;
  const name = typeof plain['name'] === 'string' ? plain['name'] : String(plain['name']);
  const nativeType = typeof plain['nativeType'] === 'string' ? plain['nativeType'] : name;
  const values = Array.isArray(plain['values']) ? (plain['values'] as string[]) : [];
  return new PostgresEnumType({ name, nativeType, values } as PostgresEnumTypeInput);
};

export class PostgresContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
  constructor() {
    // Postgres has no storage-level codec-alias entities — the
    // `storage.types` codec-triple slot is empty for Postgres contracts —
    // so the kind-keyed entity registry stays empty. Per-namespace
    // entity hydration goes through the slot-key registry: Postgres
    // registers its enum hydrator under slot key `'types'`, the slot
    // those entries flow through in this slice. The slot key renames
    // to `'postgresEnums'` when the storage shape migration lands; the
    // registry surface stays identical.
    const slotRegistry = new Map<string, SqlNamespaceSlotHydrationFactory>([
      ['types', hydratePostgresEnumType],
    ]);
    super(new Map(), slotRegistry);
  }

  protected override hydrateSqlNamespaceEntry(
    nsId: string,
    raw: Namespace | Record<string, unknown>,
  ): Namespace | SqlNamespaceTablesInput {
    if (raw instanceof NamespaceBase) {
      return raw;
    }
    const obj = raw as {
      id?: string;
      tables?: Record<string, unknown>;
      types?: Record<string, unknown>;
    };
    const id = obj.id ?? nsId;
    const tables = Object.fromEntries(
      Object.entries(obj.tables ?? {}).map(([tableName, table]) => [
        tableName,
        table instanceof StorageTable ? table : new StorageTable(table as StorageTableInput),
      ]),
    );
    const hydratedNsTypes = this.hydrateNamespaceSlot('types', obj) as
      | Record<string, PostgresEnumType>
      | undefined;

    const emptyTables = Object.keys(tables).length === 0;
    const emptyTypes = !hydratedNsTypes || Object.keys(hydratedNsTypes).length === 0;
    if (id === UNBOUND_NAMESPACE_ID && emptyTables && emptyTypes) {
      return PostgresSchema.unbound;
    }
    return new PostgresSchema({
      id,
      tables,
      ...(hydratedNsTypes !== undefined ? { types: hydratedNsTypes } : {}),
    });
  }

  override serializeContract(contract: Contract<SqlStorage>): JsonObject {
    const { storage, ...rest } = contract;
    const namespacesJson: Record<string, JsonObject> = {};
    for (const [nsId, ns] of Object.entries(storage.namespaces)) {
      if (isPostgresSchema(ns)) {
        namespacesJson[nsId] = this.serializePostgresNamespace(ns, ns.id === UNBOUND_NAMESPACE_ID);
      } else {
        // Family-level SqlNamespacePayload / SqlUnboundNamespace haven't
        // been promoted to a PostgresSchema instance yet (e.g. they came
        // straight from the TS builder, which uses the family-shared
        // SqlStorage constructor). Serialise them as postgres-schema /
        // postgres-unbound-schema so the round-trip through
        // deserializeContract hydrates them back into PostgresSchema
        // instances.
        const isUnboundSlot = nsId === UNBOUND_NAMESPACE_ID;
        const nsTypes = (ns as { readonly types?: Readonly<Record<string, unknown>> }).types ?? {};
        namespacesJson[nsId] = {
          id: nsId,
          kind: isUnboundSlot ? 'postgres-unbound-schema' : 'postgres-schema',
          tables: Object.fromEntries(
            Object.entries(ns.tables).map(([tableName, table]) => [
              tableName,
              this.serializeJsonValue(table) as JsonObject,
            ]),
          ),
          types: Object.fromEntries(
            Object.entries(nsTypes).map(([typeName, entry]) => [
              typeName,
              this.serializeJsonValue(entry) as JsonObject,
            ]),
          ),
        };
      }
    }
    const storageOut: Record<string, unknown> = {
      storageHash: String(storage.storageHash),
      namespaces: namespacesJson,
    };
    if (storage.types !== undefined) {
      const typesOut: Record<string, JsonObject> = {};
      for (const [name, entry] of Object.entries(storage.types)) {
        typesOut[name] = this.serializeJsonValue(entry) as JsonObject;
      }
      storageOut['types'] = typesOut;
    }
    return {
      ...rest,
      storage: storageOut,
    } as unknown as JsonObject;
  }

  private serializePostgresNamespace(ns: PostgresSchema, isUnboundSlot: boolean): JsonObject {
    const tablesOut: Record<string, JsonObject> = {};
    for (const [tableName, table] of Object.entries(ns.tables)) {
      tablesOut[tableName] = this.serializeJsonValue(table) as JsonObject;
    }
    const typesOut: Record<string, JsonObject> = {};
    for (const [typeName, ty] of Object.entries(ns.types)) {
      typesOut[typeName] = this.serializeJsonValue(ty) as JsonObject;
    }
    return {
      id: ns.id,
      kind: isUnboundSlot ? 'postgres-unbound-schema' : 'postgres-schema',
      tables: tablesOut,
      types: typesOut,
    };
  }

  private serializeJsonValue(value: unknown): unknown {
    return JSON.parse(JSON.stringify(value)) as unknown;
  }
}
