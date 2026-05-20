import type { Contract } from '@prisma-next/contract/types';
import {
  SqlContractSerializerBase,
  type SqlNamespaceSlotHydrationFactory,
} from '@prisma-next/family-sql/ir';
import {
  type AuthoringEntityTypeNamespace,
  isAuthoringEntityTypeDescriptor,
} from '@prisma-next/framework-components/authoring';
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
import type { Type } from 'arktype';
import { postgresAuthoringEntityTypes } from './authoring';
import type { PostgresEnumType } from './postgres-enum-type';
import { isPostgresSchema, PostgresSchema } from './postgres-schema';

/**
 * Walks a pack's entity-type namespace tree and emits the
 * `storageSlotKey`-keyed maps the family base consumes — one map of
 * hydrators, one map of validator-schema fragments. Only descriptors
 * that declared a `storageSlotKey` participate in either map; the
 * corresponding `hydrate` / `validatorSchema` field is the seam.
 */
function collectEntityRegistryContributions(namespace: AuthoringEntityTypeNamespace): {
  readonly slotRegistry: ReadonlyMap<string, SqlNamespaceSlotHydrationFactory>;
  readonly validatorFragments: ReadonlyMap<string, Type<unknown>>;
} {
  const slotRegistry = new Map<string, SqlNamespaceSlotHydrationFactory>();
  const validatorFragments = new Map<string, Type<unknown>>();
  const walk = (node: AuthoringEntityTypeNamespace): void => {
    for (const value of Object.values(node)) {
      if (isAuthoringEntityTypeDescriptor(value)) {
        if (value.storageSlotKey !== undefined && value.hydrate !== undefined) {
          slotRegistry.set(value.storageSlotKey, value.hydrate);
        }
        if (value.storageSlotKey !== undefined && value.validatorSchema !== undefined) {
          validatorFragments.set(value.storageSlotKey, value.validatorSchema);
        }
        continue;
      }
      if (typeof value === 'object' && value !== null) {
        walk(value);
      }
    }
  };
  walk(namespace);
  return { slotRegistry, validatorFragments };
}

export class PostgresContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
  constructor() {
    // Postgres has no storage-level codec-alias entities — the
    // `storage.types` codec-triple slot is empty for Postgres
    // contracts — so the kind-keyed entity registry stays empty.
    // Per-namespace entity hydration and validation are derived from
    // the pack's authoring contributions: every descriptor that
    // declared a `storageSlotKey` + `hydrate` / `validatorSchema`
    // wires its slot through the family-base registry. Slot key
    // currently `'types'` (matches the slot enum entries flow through
    // today); renames to `'postgresEnums'` when the storage shape
    // migration lands — the registry surface stays identical.
    const { slotRegistry, validatorFragments } = collectEntityRegistryContributions(
      postgresAuthoringEntityTypes,
    );
    super(new Map(), slotRegistry, validatorFragments);
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
