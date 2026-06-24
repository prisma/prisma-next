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
  type AnyEntityKindDescriptor,
  type Namespace,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import type { SqlNamespaceInput, SqlStorage } from '@prisma-next/sql-contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import type { JsonObject, JsonValue } from '@prisma-next/utils/json';
import { postgresAuthoringEntityTypes } from './authoring';
import { postgresTargetDescriptorMeta } from './descriptor-meta';
import { policyEntityKind, roleEntityKind } from './entity-kinds';
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
    'factory' in output &&
    typeof output.factory === 'function'
  );
}

/**
 * Walks a pack's entity-type namespace tree and emits hydration factories
 * keyed by the descriptor's `discriminator`. Used for `storage.types`
 * (codec-triple hydration). Namespace entries hydration dispatches by
 * entries key, not discriminator — handled by `hydrateNamespaceEntities`.
 */
function collectStorageTypesHydrators(
  namespace: AuthoringEntityTypeNamespace,
): ReadonlyMap<string, SqlEntityHydrationFactory> {
  const registry = new Map<string, SqlEntityHydrationFactory>();
  const walk = (node: AuthoringEntityTypeNamespace): void => {
    for (const value of Object.values(node)) {
      if (isAuthoringEntityTypeDescriptor(value)) {
        if (isAuthoringEntityTypeFactoryOutput(value.output)) {
          const { factory } = value.output;
          registry.set(value.discriminator, (raw) => factory(raw, POSTGRES_AUTHORING_CTX));
        }
        continue;
      }
      if (typeof value === 'object' && value !== null) {
        walk(value);
      }
    }
  };
  walk(namespace);
  return registry;
}

export class PostgresContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
  constructor(extraPackEntityKinds: readonly AnyEntityKindDescriptor[] = []) {
    const storageTypesHydrators = collectStorageTypesHydrators(postgresAuthoringEntityTypes);
    super(storageTypesHydrators, [policyEntityKind, roleEntityKind, ...extraPackEntityKinds]);
  }

  protected override hydrateSqlNamespaceEntry(
    nsId: string,
    raw: Record<string, unknown>,
  ): Namespace | SqlNamespaceInput {
    const hydrated = blindCast<
      SqlNamespaceInput,
      'raw is always plain JSON, so super.hydrateSqlNamespaceEntry returns SqlNamespaceInput'
    >(super.hydrateSqlNamespaceEntry(nsId, raw));
    const { id, entries } = hydrated;

    const allSlotsEmpty = Object.values(entries).every(
      (slot) => slot === undefined || Object.keys(slot).length === 0,
    );
    if (id === UNBOUND_NAMESPACE_ID && allSlotsEmpty) {
      return PostgresSchema.unbound;
    }
    const valueSetSlot = entries['valueSet'];
    const hasValueSets = valueSetSlot !== undefined && Object.keys(valueSetSlot).length > 0;
    return new PostgresSchema({
      id,
      entries: {
        ...entries,
        table: entries['table'] ?? {},
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
              Object.entries(ns.entries.table ?? {}).map(([tableName, table]) => [
                tableName,
                this.serializeJsonObject(table),
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
        typesOut[name] = this.serializeJsonObject(entry);
      }
      storageOut['types'] = typesOut;
    }
    return blindCast<
      JsonObject,
      'contract minus storage plus a JSON-shaped storageOut is a JsonObject'
    >({
      ...rest,
      storage: storageOut,
    });
  }

  private serializePostgresNamespace(ns: PostgresSchema, isUnboundSlot: boolean): JsonObject {
    const tablesOut: Record<string, JsonObject> = {};
    for (const [tableName, table] of Object.entries(ns.table)) {
      tablesOut[tableName] = this.serializeJsonObject(table);
    }
    const valueSetEntries = ns.valueSet;
    const valueSetOut: Record<string, JsonObject> = {};
    if (valueSetEntries !== undefined) {
      for (const [valueSetName, valueSet] of Object.entries(valueSetEntries)) {
        valueSetOut[valueSetName] = this.serializeJsonObject(valueSet);
      }
    }
    const roleOut: Record<string, JsonObject> = {};
    for (const [roleName, role] of Object.entries(ns.role)) {
      roleOut[roleName] = this.serializeJsonObject(role);
    }
    const policyOut: Record<string, JsonObject> = {};
    for (const [policyName, policy] of Object.entries(ns.policy)) {
      policyOut[policyName] = this.serializeJsonObject(policy);
    }
    return {
      id: ns.id,
      kind: isUnboundSlot ? 'postgres-unbound-schema' : 'postgres-schema',
      entries: {
        table: tablesOut,
        ...(Object.keys(valueSetOut).length > 0 ? { valueSet: valueSetOut } : {}),
        ...(Object.keys(roleOut).length > 0 ? { role: roleOut } : {}),
        ...(Object.keys(policyOut).length > 0 ? { policy: policyOut } : {}),
      },
    };
  }

  private serializeJsonObject(value: unknown): JsonObject {
    return blindCast<
      JsonObject,
      'serializeJsonValue round-trips an IR node through JSON, yielding a JsonObject'
    >(this.serializeJsonValue(value));
  }

  private serializeJsonValue(value: unknown): JsonValue {
    return blindCast<JsonValue, 'JSON.parse(JSON.stringify(x)) yields a JsonValue'>(
      JSON.parse(JSON.stringify(value)),
    );
  }
}
