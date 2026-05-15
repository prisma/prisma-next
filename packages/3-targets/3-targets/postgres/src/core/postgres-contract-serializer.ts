import type { Contract } from '@prisma-next/contract/types';
import {
  SqlContractSerializerBase,
  type SqlEntityHydrationFactory,
} from '@prisma-next/family-sql/ir';
import type { AuthoringEntityContext } from '@prisma-next/framework-components/authoring';
import type { SqlStorage, SqlStorageTypeEntry } from '@prisma-next/sql-contract/types';
import { postgresAuthoringEntityTypes } from './authoring';
import { PostgresEnumType } from './postgres-enum-type';

/**
 * Build the hydration registry from this target pack's literal
 * `postgresAuthoringEntityTypes`. Extension-pack-contributed entity
 * types do not reach this registry today; the surface is honest for
 * in-tree consumers (Postgres pack only) and the slot stays
 * deserializable because the family-layer validator's
 * `StorageTypeEntrySchema` only admits kinds whose factory the
 * Postgres pack already ships.
 *
 * Future open (F14): lift the registry build to descriptor-composition
 * time, threading the composed `AuthoringContributions.entityTypes`
 * from extension packs, so a real extension pack shipping a
 * round-trip-needing entity type can be deserialized end-to-end.
 * Earned by the first such extension pack in tree.
 */
function buildPostgresEntityTypeRegistry(): ReadonlyMap<string, SqlEntityHydrationFactory> {
  const ctx: AuthoringEntityContext = { family: 'sql', target: 'postgres' };
  const registry = new Map<string, SqlEntityHydrationFactory>();
  for (const descriptor of Object.values(postgresAuthoringEntityTypes)) {
    if (descriptor.kind !== 'entity') {
      continue;
    }
    if (!('factory' in descriptor.output)) {
      continue;
    }
    const factory = descriptor.output.factory as (
      input: never,
      ctx: AuthoringEntityContext,
    ) => SqlStorageTypeEntry;
    registry.set(descriptor.discriminator, (entry) => {
      if (entry instanceof PostgresEnumType) {
        return entry;
      }
      return factory(entry as never, ctx);
    });
  }
  return registry;
}

/**
 * Postgres target `ContractSerializer` concretion. Inherits the full
 * SQL-family deserialization pipeline (structural validation +
 * hydration walker that materialises the SQL Contract IR class
 * hierarchy from the validated JSON envelope). Polymorphic
 * `storage.types` entries hydrate through the pack contribution registry
 * keyed by each entity type's declared `discriminator` (matching the
 * enumerable `kind` on the persisted JSON envelope).
 *
 * `serializeContract` falls through to the family-base default —
 * Postgres' contract is JSON-clean today (`PostgresEnumType`
 * instances are frozen with enumerable own properties, so
 * `JSON.stringify` produces the canonical envelope shape). Once
 * target-only fields land (e.g. per-target derived storage fields)
 * this is the home for stripping them from the persisted envelope.
 */
export class PostgresContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
  constructor() {
    super(buildPostgresEntityTypeRegistry());
  }
}
