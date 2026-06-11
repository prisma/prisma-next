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
import type { SqlNamespaceTablesInput, SqlStorage } from '@prisma-next/sql-contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import type { JsonObject } from '@prisma-next/utils/json';
import type { Type } from 'arktype';
import { postgresAuthoringEntityTypes } from './authoring';
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
          entityTypeRegistry.set(value.discriminator, (raw) =>
            factory(raw, POSTGRES_AUTHORING_CTX),
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
    const hydrated = blindCast<
      SqlNamespaceTablesInput,
      'super.hydrateSqlNamespaceEntry returns the tables form when raw is not a NamespaceBase'
    >(super.hydrateSqlNamespaceEntry(nsId, raw));
    const { id, entries } = hydrated;

    const valueSetSlot = entries.valueSet;
    const hasValueSets = valueSetSlot !== undefined && Object.keys(valueSetSlot).length > 0;
    const emptyTables = Object.keys(entries.table).length === 0;
    if (id === UNBOUND_NAMESPACE_ID && emptyTables && !hasValueSets) {
      return PostgresSchema.unbound;
    }
    return new PostgresSchema({
      id,
      entries: {
        table: entries.table,
        ...(hasValueSets ? { valueSet: valueSetSlot } : {}),
      },
    });
  }

  override serializeContract(contract: Contract<SqlStorage>): JsonObject {
    const { storage, ...rest } = contract;
    const namespacesJson: Record<string, JsonObject> = {};
    for (const [nsId, ns] of Object.entries(storage.namespaces)) {
      if (isPostgresSchema(ns)) {
        namespacesJson[nsId] = this.serializePostgresNamespace(ns, ns.id === UNBOUND_NAMESPACE_ID);
      } else {
        const isUnboundSlot = nsId === UNBOUND_NAMESPACE_ID;
        namespacesJson[nsId] = {
          id: nsId,
          kind: isUnboundSlot ? 'postgres-unbound-schema' : 'postgres-schema',
          entries: {
            table: Object.fromEntries(
              Object.entries(ns.entries.table).map(([tableName, table]) => [
                tableName,
                this.serializeJsonValue(table) as JsonObject,
              ]),
            ),
          },
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
    for (const [tableName, table] of Object.entries(ns.entries.table)) {
      tablesOut[tableName] = this.serializeJsonValue(table) as JsonObject;
    }
    const valueSetEntries = ns.entries.valueSet;
    const valueSetOut: Record<string, JsonObject> = {};
    if (valueSetEntries !== undefined) {
      for (const [valueSetName, valueSet] of Object.entries(valueSetEntries)) {
        valueSetOut[valueSetName] = blindCast<
          JsonObject,
          'serializeJsonValue round-trips the value-set node through JSON, yielding a JsonObject'
        >(this.serializeJsonValue(valueSet));
      }
    }
    return {
      id: ns.id,
      kind: isUnboundSlot ? 'postgres-unbound-schema' : 'postgres-schema',
      entries: {
        table: tablesOut,
        ...(Object.keys(valueSetOut).length > 0 ? { valueSet: valueSetOut } : {}),
      },
    };
  }

  private serializeJsonValue(value: unknown): unknown {
    return JSON.parse(JSON.stringify(value)) as unknown;
  }
}
