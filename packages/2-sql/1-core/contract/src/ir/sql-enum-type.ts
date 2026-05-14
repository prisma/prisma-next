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
 * (`'sql-enum-type'`) because it carries dispatch-relevant
 * information that callers need to see in the JSON envelope —
 * Option B (polymorphic `storage.types`) keys hydration on this
 * literal to construct the right subclass.
 */
export abstract class SqlEnumType extends SqlNode {
  override readonly kind = 'sql-enum-type';
  abstract readonly name: string;
  abstract readonly nativeType: string;
  abstract readonly values: readonly string[];

  constructor() {
    super();
    // Re-install `kind` as an enumerable own property so JSON.stringify
    // surfaces it (the `SqlNode` base installs a non-enumerable `'sql'`
    // own property; per-leaf earned discriminators override that with
    // an enumerable narrower literal so consumers reading raw JSON can
    // dispatch on `kind === 'sql-enum-type'`).
    Object.defineProperty(this, 'kind', {
      value: 'sql-enum-type',
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}
