import type { Contract } from '@prisma-next/contract/types';
import {
  SqlContractSerializerBase,
  type SqlEntityHydrationFactory,
} from '@prisma-next/family-sql/ir';
import {
  type AuthoringEntityContext,
  type AuthoringEntityTypeFactoryOutput,
  type AuthoringEntityTypeNamespace,
  isAuthoringEntityTypeDescriptor,
} from '@prisma-next/framework-components/authoring';
import {
  type Namespace,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import type {
  SqlNamespaceTablesInput,
  SqlStorage,
  SqlStorageTypeEntry,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import type { JsonObject } from '@prisma-next/utils/json';
import type { Type } from 'arktype';
import { postgresAuthoringEntityTypes } from './authoring';
import type { PostgresEnumType } from './postgres-enum-type';
import { isPostgresSchema, PostgresSchema } from './postgres-schema';

const POSTGRES_AUTHORING_CTX: AuthoringEntityContext = {
  family: 'sql',
  target: 'postgres',
};

function isAuthoringEntityTypeFactoryOutput(
  output: unknown,
): output is AuthoringEntityTypeFactoryOutput<unknown, unknown> {
  return (
    typeof output === 'object' &&
    output !== null &&
    typeof (output as AuthoringEntityTypeFactoryOutput).factory === 'function'
  );
}

/**
 * Walks a pack's entity-type namespace tree and emits the maps the
 * family base consumes — hydrators and validator-schema fragments, both
 * keyed by the descriptor's `discriminator`.
 */
function collectEntityRegistryContributions(namespace: AuthoringEntityTypeNamespace): {
  readonly entityTypeRegistry: ReadonlyMap<string, SqlEntityHydrationFactory>;
  readonly validatorFragments: ReadonlyMap<string, Type<unknown>>;
} {
  const entityTypeRegistry = new Map<string, SqlEntityHydrationFactory>();
  const validatorFragments = new Map<string, Type<unknown>>();
  const walk = (node: AuthoringEntityTypeNamespace): void => {
    for (const value of Object.values(node)) {
      if (isAuthoringEntityTypeDescriptor(value)) {
        if (isAuthoringEntityTypeFactoryOutput(value.output)) {
          const { factory } = value.output;
          entityTypeRegistry.set(
            value.discriminator,
            (raw) => factory(raw, POSTGRES_AUTHORING_CTX) as SqlStorageTypeEntry,
          );
        }
        if (value.validatorSchema !== undefined) {
          validatorFragments.set(value.discriminator, value.validatorSchema);
        }
        continue;
      }
      if (typeof value === 'object' && value !== null) {
        walk(value);
      }
    }
  };
  walk(namespace);
  return { entityTypeRegistry, validatorFragments };
}

export class PostgresContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
  constructor() {
    const { entityTypeRegistry, validatorFragments } = collectEntityRegistryContributions(
      postgresAuthoringEntityTypes,
    );
    super(entityTypeRegistry, validatorFragments);
  }

  protected override hydrateSqlNamespaceEntry(
    nsId: string,
    raw: Namespace | Record<string, unknown>,
  ): Namespace | SqlNamespaceTablesInput {
    if (raw instanceof NamespaceBase) {
      return raw;
    }
    const hydrated = super.hydrateSqlNamespaceEntry(nsId, raw) as {
      id: string;
      tables: Readonly<Record<string, StorageTable>>;
      enum?: Readonly<Record<string, PostgresEnumType>>;
    };
    const { id, tables, enum: hydratedNsEnums } = hydrated;

    const emptyTables = Object.keys(tables).length === 0;
    const emptyEnums = !hydratedNsEnums || Object.keys(hydratedNsEnums).length === 0;
    if (id === UNBOUND_NAMESPACE_ID && emptyTables && emptyEnums) {
      return PostgresSchema.unbound;
    }
    return new PostgresSchema({
      id,
      tables,
      ...(hydratedNsEnums !== undefined ? { enum: hydratedNsEnums } : {}),
    });
  }

  override serializeContract(contract: Contract<SqlStorage>): JsonObject {
    const { storage, ...rest } = contract;
    const namespacesJson: Record<string, JsonObject> = {};
    for (const [nsId, ns] of Object.entries(storage.namespaces)) {
      if (isPostgresSchema(ns)) {
        namespacesJson[nsId] = this.serializePostgresNamespace(ns, ns.id === UNBOUND_NAMESPACE_ID);
      } else {
        // Family-level SqlUnboundNamespace or other family-built SQL
        // namespaces haven't been promoted to a PostgresSchema instance
        // yet (e.g. they came straight from the TS builder before a target
        // `createNamespace` factory ran). Serialise them as postgres-schema /
        // postgres-unbound-schema so the round-trip through
        // deserializeContract hydrates them back into PostgresSchema
        // instances.
        const isUnboundSlot = nsId === UNBOUND_NAMESPACE_ID;
        const nsEnums = (ns as { readonly enum?: Readonly<Record<string, unknown>> }).enum ?? {};
        namespacesJson[nsId] = {
          id: nsId,
          kind: isUnboundSlot ? 'postgres-unbound-schema' : 'postgres-schema',
          tables: Object.fromEntries(
            Object.entries(ns.tables).map(([tableName, table]) => [
              tableName,
              this.serializeJsonValue(table) as JsonObject,
            ]),
          ),
          enum: Object.fromEntries(
            Object.entries(nsEnums).map(([typeName, entry]) => [
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
    const enumOut: Record<string, JsonObject> = {};
    for (const [typeName, ty] of Object.entries(ns.enum)) {
      enumOut[typeName] = this.serializeJsonValue(ty) as JsonObject;
    }
    return {
      id: ns.id,
      kind: isUnboundSlot ? 'postgres-unbound-schema' : 'postgres-schema',
      tables: tablesOut,
      enum: enumOut,
    };
  }

  private serializeJsonValue(value: unknown): unknown {
    return JSON.parse(JSON.stringify(value)) as unknown;
  }
}
