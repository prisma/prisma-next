import type { Contract } from '@prisma-next/contract/types';
import { SqlContractSerializerBase } from '@prisma-next/family-sql/ir';
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
import { PostgresSchema } from './postgres-schema';

export class PostgresContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
  constructor() {
    // Postgres entity types (enums) are namespace-level and hydrated in
    // hydrateSqlNamespaceEntry; there are no storage-level codec alias entities
    // specific to Postgres, so the registry is empty.
    super(new Map());
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
    const typeEntries = obj.types;
    const hydratedNsTypes =
      typeEntries !== undefined && Object.keys(typeEntries).length > 0
        ? Object.fromEntries(
            Object.entries(typeEntries).map(([typeName, entry]) => {
              if (entry instanceof PostgresEnumType) {
                return [typeName, entry];
              }
              const plain = entry as Record<string, unknown>;
              const name = typeof plain['name'] === 'string' ? plain['name'] : typeName;
              const nativeType =
                typeof plain['nativeType'] === 'string' ? plain['nativeType'] : name;
              const values = Array.isArray(plain['values']) ? (plain['values'] as string[]) : [];
              return [
                typeName,
                new PostgresEnumType({ name, nativeType, values } as PostgresEnumTypeInput),
              ];
            }),
          )
        : undefined;

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
      if (ns instanceof PostgresSchema) {
        namespacesJson[nsId] = this.serializePostgresNamespace(ns, ns.id === UNBOUND_NAMESPACE_ID);
      } else if (nsId === UNBOUND_NAMESPACE_ID) {
        // Family-level SqlUnboundNamespace is the default singleton for
        // Postgres contracts that don't yet declare a `namespace unbound`
        // block. Serialise it as a postgres-unbound-schema with the same
        // tables/types semantics PostgresSchema would produce.
        namespacesJson[nsId] = {
          id: nsId,
          kind: 'postgres-unbound-schema',
          tables: Object.fromEntries(
            Object.entries(ns.tables).map(([tableName, table]) => [
              tableName,
              this.serializeJsonValue(table) as JsonObject,
            ]),
          ),
          types: {},
        };
      } else {
        throw new Error(
          `PostgresContractSerializer.serializeContract: unexpected namespace value for "${nsId}"`,
        );
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
