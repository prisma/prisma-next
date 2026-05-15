import { SqlNode } from './sql-node';

/**
 * SQL family abstract base for enum-typed entries in `SqlStorage.types`.
 *
 * Earns its existence by polymorphic-dispatch consumers — the SQL
 * schema verifier and the migration planner walk enum types separately
 * from codec-typed entries (decimal / varchar / pgvector). The
 * verifier compares `SqlEnumType.values` against an introspected enum
 * shape; the planner emits `CREATE TYPE … AS ENUM` / `ALTER TYPE …
 * ADD VALUE` operations directly from the IR. Codec-typed entries
 * continue to flow through the generic per-codec `verifyType` /
 * `planTypeOperations` codec hooks.
 *
 * The family base is abstract today with one concrete subclass
 * (`PostgresEnumType` at `target-postgres`). SQLite emulates enums via
 * CHECK constraints rather than a native type, so it does not earn a
 * `SqliteEnumType` subclass; if a future SQL target gains native enum
 * support it slots in alongside Postgres without restructuring the
 * family base.
 *
 * Per Decision 16, the per-leaf `kind` discriminator is enumerable
 * (`'postgres-enum'`) because it carries dispatch-relevant information
 * that callers need to see in the JSON envelope — Option B
 * (polymorphic `storage.types`) keys hydration on this literal to
 * construct the right subclass. The discriminator reflects the
 * target altitude (Postgres only; per Decision 18 enum is target-only)
 * rather than the family altitude.
 */
export abstract class SqlEnumType extends SqlNode {
  override readonly kind = 'postgres-enum';
  abstract readonly name: string;
  abstract readonly nativeType: string;
  abstract readonly values: readonly string[];

  /**
   * Per-target codec binding used to wire columns whose `typeRef`
   * resolves to this enum. The runtime / lowering pipeline still
   * routes enum columns through the existing per-target codec
   * (Postgres → `pg/enum@1`); this binding lives on the IR class so
   * family-shared code (e.g. `codecRefForStorageColumn`,
   * lane-time codec resolution) can dispatch uniformly without
   * importing target-specific codec ids.
   *
   * Declared as a prototype-level abstract accessor so it lives on
   * the prototype (not instance own-properties) and stays out of the
   * JSON envelope automatically — `kind`, `name`, `nativeType`, and
   * `values` are the enumerable own properties contributed by this
   * family base. Concrete subclasses may add additional enumerable
   * own properties (e.g. `PostgresEnumType.codecId`) when the
   * persisted envelope demands them.
   */
  abstract get codecBinding(): {
    readonly codecId: string;
    readonly typeParams: { readonly values: readonly string[] };
  };
}
