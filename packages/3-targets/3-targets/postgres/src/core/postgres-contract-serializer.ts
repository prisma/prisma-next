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
import { type as arktypeType, type Type } from 'arktype';
import { postgresAuthoringEntityTypes } from './authoring';
import type { PostgresEnumType } from './postgres-enum-type';
import type { PostgresRlsPolicy } from './postgres-rls-policy';
import type { PostgresRole } from './postgres-role';
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
 * family base consumes — hydrators, validator-schema fragments (keyed
 * by discriminator), and validator entry slots (keyed by slot name)
 * for entity kinds that declare an `entrySlotName`.
 */
function collectEntityRegistryContributions(namespace: AuthoringEntityTypeNamespace): {
  readonly entityTypeRegistry: ReadonlyMap<string, SqlEntityHydrationFactory>;
  readonly validatorFragments: ReadonlyMap<string, Type<unknown>>;
  readonly validatorEntrySlots: ReadonlyMap<string, Type<unknown>>;
} {
  const entityTypeRegistry = new Map<string, SqlEntityHydrationFactory>();
  const validatorFragments = new Map<string, Type<unknown>>();
  const entrySlotFragments = new Map<string, Type<unknown>>();
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
          if (value.entrySlotName !== undefined) {
            const existing = entrySlotFragments.get(value.entrySlotName);
            const schema =
              existing !== undefined ? existing.or(value.validatorSchema) : value.validatorSchema;
            entrySlotFragments.set(value.entrySlotName, schema);
          }
        }
        continue;
      }
      if (typeof value === 'object' && value !== null) {
        walk(value);
      }
    }
  };
  walk(namespace);
  const validatorEntrySlots = new Map<string, Type<unknown>>();
  for (const [slotName, schema] of entrySlotFragments) {
    validatorEntrySlots.set(slotName, arktypeType({ '[string]': schema }));
  }
  return { entityTypeRegistry, validatorFragments, validatorEntrySlots };
}

export class PostgresContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
  constructor() {
    const { entityTypeRegistry, validatorFragments, validatorEntrySlots } =
      collectEntityRegistryContributions(postgresAuthoringEntityTypes);
    super(entityTypeRegistry, validatorFragments, validatorEntrySlots);
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

    // Extract postgres-specific slots directly from raw input.
    // The family base handles `table`; the postgres target owns `type`, `role`, `rlsPolicy`.
    const rawRecord = raw as Record<string, unknown>;
    const rawEntries = rawRecord['entries'];
    let typeSlot: Record<string, PostgresEnumType> | undefined;
    let roleSlot: Record<string, PostgresRole> | undefined;
    let rlsPolicySlot: Record<string, PostgresRlsPolicy> | undefined;

    if (rawEntries !== null && typeof rawEntries === 'object' && !Array.isArray(rawEntries)) {
      const entriesRecord = rawEntries as Record<string, unknown>;

      const rawTypeSlot = entriesRecord['type'];
      if (rawTypeSlot !== null && typeof rawTypeSlot === 'object' && !Array.isArray(rawTypeSlot)) {
        const enumFactory = this.entityTypeRegistry.get('postgres-enum');
        typeSlot = Object.fromEntries(
          Object.entries(rawTypeSlot as Record<string, unknown>).map(([name, entry]) => [
            name,
            blindCast<PostgresEnumType, 'postgres-enum factory returns PostgresEnumType'>(
              enumFactory !== undefined ? enumFactory(entry) : entry,
            ),
          ]),
        );
      }

      const rawRoleSlot = entriesRecord['role'];
      if (rawRoleSlot !== null && typeof rawRoleSlot === 'object' && !Array.isArray(rawRoleSlot)) {
        const roleFactory = this.entityTypeRegistry.get('postgres-role');
        roleSlot = Object.fromEntries(
          Object.entries(rawRoleSlot as Record<string, unknown>).map(([name, entry]) => [
            name,
            blindCast<PostgresRole, 'postgres-role factory returns PostgresRole'>(
              roleFactory !== undefined ? roleFactory(entry) : entry,
            ),
          ]),
        );
      }

      const rawRlsPolicySlot = entriesRecord['rlsPolicy'];
      if (
        rawRlsPolicySlot !== null &&
        typeof rawRlsPolicySlot === 'object' &&
        !Array.isArray(rawRlsPolicySlot)
      ) {
        // Pass raw entries directly — the PostgresSchema constructor already
        // handles PostgresRlsPolicyInput objects. The rlsPolicy authoring
        // factory lowers PslExtensionBlock nodes (PSL path), not JSON (this path).
        rlsPolicySlot = Object.fromEntries(
          Object.entries(rawRlsPolicySlot as Record<string, unknown>).map(([name, entry]) => [
            name,
            blindCast<
              PostgresRlsPolicy,
              'PostgresSchema constructor accepts PostgresRlsPolicyInput'
            >(entry),
          ]),
        );
      }
    }

    const emptyTables = Object.keys(entries.table).length === 0;
    const emptyTypes = !typeSlot || Object.keys(typeSlot).length === 0;
    const emptyRoles = !roleSlot || Object.keys(roleSlot).length === 0;
    const emptyPolicies = !rlsPolicySlot || Object.keys(rlsPolicySlot).length === 0;
    if (id === UNBOUND_NAMESPACE_ID && emptyTables && emptyTypes && emptyRoles && emptyPolicies) {
      return PostgresSchema.unbound;
    }
    return new PostgresSchema({
      id,
      entries: {
        table: entries.table,
        type: typeSlot ?? {},
        role: roleSlot ?? {},
        rlsPolicy: rlsPolicySlot ?? {},
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
    const typeOut: Record<string, JsonObject> = {};
    for (const [typeName, ty] of Object.entries(ns.entries.type)) {
      typeOut[typeName] = this.serializeJsonValue(ty) as JsonObject;
    }
    const roleOut: Record<string, JsonObject> = {};
    for (const [roleName, role] of Object.entries(ns.entries.role)) {
      roleOut[roleName] = this.serializeJsonValue(role) as JsonObject;
    }
    const rlsPolicyOut: Record<string, JsonObject> = {};
    for (const [policyName, policy] of Object.entries(ns.entries.rlsPolicy)) {
      rlsPolicyOut[policyName] = this.serializeJsonValue(policy) as JsonObject;
    }
    return {
      id: ns.id,
      kind: isUnboundSlot ? 'postgres-unbound-schema' : 'postgres-schema',
      entries: {
        table: tablesOut,
        type: typeOut,
        role: roleOut,
        rlsPolicy: rlsPolicyOut,
      },
    };
  }

  private serializeJsonValue(value: unknown): unknown {
    return JSON.parse(JSON.stringify(value)) as unknown;
  }
}
