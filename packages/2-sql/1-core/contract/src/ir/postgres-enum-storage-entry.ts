import type { ControlPolicy } from '@prisma-next/contract/types';
import type { StorageType } from '@prisma-next/framework-components/ir';

/**
 * Discriminator literal for the Postgres-enum variant on the polymorphic
 * `SqlStorage.types` slot.
 *
 * Enums are a target-level concept: Postgres ships native
 * `CREATE TYPE … AS ENUM` while other SQL targets approximate enums via
 * constraints. The literal lives at the SQL family layer because every
 * SQL-family consumer (verifier, planner, lowering, …) needs to
 * discriminate enum-typed slot entries from codec-typed ones. The
 * concrete IR class (`PostgresEnumType`) lives in the target-postgres
 * package and implements this structural contract; cross-domain
 * layering rules forbid the SQL family from importing the concrete
 * target class directly, so the discriminator and structural interface
 * carry the dispatch.
 */
export const POSTGRES_ENUM_KIND = 'postgres-enum' as const;

/**
 * Structural contract every Postgres-enum slot entry honours — both
 * the live `PostgresEnumType` IR-class instance and the raw JSON
 * envelope shape that survives `JSON.stringify` round-trips. SQL
 * family-layer dispatch narrows polymorphic `StorageType` slot
 * entries to this shape via `isPostgresEnumStorageEntry`.
 *
 * The `codecBinding` field is accessor-shaped (live class instance) on
 * the IR class and undefined on the raw JSON envelope; consumers that
 * need it must guard for its presence (the JSON path synthesises an
 * equivalent shape from `codecId` + `values`).
 */
export interface PostgresEnumStorageEntry extends StorageType {
  readonly kind: typeof POSTGRES_ENUM_KIND;
  readonly name: string;
  readonly nativeType: string;
  readonly values: readonly string[];
  /**
   * Enumerable own property on the persisted JSON envelope; the live
   * IR-class instance carries it too. Family-shared dispatch sites
   * read `codecId` directly rather than going through the IR-class
   * `codecBinding` accessor (which lives on the prototype and isn't
   * present on raw JSON envelopes).
   */
  readonly codecId: string;
  readonly control?: ControlPolicy;
}

/**
 * Narrow a polymorphic `StorageType` entry to the Postgres-enum shape
 * via its enumerable `kind` discriminator. Type guard returns true for
 * both live `PostgresEnumType` instances and raw JSON envelopes.
 */
export function isPostgresEnumStorageEntry(value: unknown): value is PostgresEnumStorageEntry {
  if (typeof value !== 'object' || value === null) return false;
  return (value as { kind?: unknown }).kind === POSTGRES_ENUM_KIND;
}
