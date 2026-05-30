import type { Contract, ContractMarkerRecord } from '@prisma-next/contract/types';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlStack,
} from '@prisma-next/framework-components/control';
import type { PostgresEnumStorageEntry, SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  AnyQueryAst,
  LoweredStatement,
  LowererContext,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import type { DefaultNormalizer, NativeTypeNormalizer } from './schema-verify/verify-sql-schema';

/**
 * SQL control adapter interface for control-plane operations.
 * Implemented by target-specific adapters (e.g., Postgres, MySQL).
 *
 * @template TTarget - The target ID (e.g., 'postgres', 'mysql')
 */
export interface SqlControlAdapter<TTarget extends string = string>
  extends ControlAdapterInstance<'sql', TTarget> {
  /**
   * Reads the contract marker for `space` from the database, returning
   * `null` if no marker row exists for that space (or if the marker
   * table itself is missing). Implementations are responsible for the
   * dialect-specific existence probe (e.g. Postgres
   * `information_schema.tables` vs SQLite `sqlite_master`) and parameter
   * placeholders.
   *
   * `space` is required so callers cannot accidentally fall through to
   * the app's marker row when reading per-extension markers.
   *
   * @param driver - ControlDriverInstance for executing queries (target-specific)
   * @param space - Contract space id whose marker row to read (e.g. `'app'`)
   * @returns Resolved marker record, or `null` if not yet stamped.
   */
  readMarker(
    driver: ControlDriverInstance<'sql', TTarget>,
    space: string,
  ): Promise<ContractMarkerRecord | null>;

  /**
   * Reads every marker row from `prisma_contract.marker` (one per
   * contract space) and returns them keyed by `space`. Used by the
   * per-space verifier to detect marker-vs-on-disk drift and orphan
   * marker rows. Returns an empty map when the marker table does not
   * yet exist (fresh database / never-signed project).
   */
  readAllMarkers(
    driver: ControlDriverInstance<'sql', TTarget>,
  ): Promise<ReadonlyMap<string, ContractMarkerRecord>>;

  /**
   * Introspects a database schema and returns a raw SqlSchemaIR.
   *
   * This is a pure schema discovery operation that queries the database catalog
   * and returns the schema structure without type mapping or contract enrichment.
   * Type mapping and enrichment are handled separately by enrichment helpers.
   *
   * @param driver - ControlDriverInstance instance for executing queries (target-specific)
   * @param contract - Optional contract for contract-guided introspection (filtering, optimization)
   * @param schema - Schema name to introspect (defaults to 'public')
   * @returns Promise resolving to SqlSchemaIR representing the live database schema
   */
  introspect(
    driver: ControlDriverInstance<'sql', TTarget>,
    contract?: unknown,
    schema?: string,
  ): Promise<SqlSchemaIR>;

  /**
   * Optional target-specific normalizer for raw database default expressions.
   * When provided, schema defaults (raw strings) are normalized before comparison
   * with contract defaults (ColumnDefault objects) during schema verification.
   */
  readonly normalizeDefault?: DefaultNormalizer;

  /**
   * Optional target-specific normalizer for schema native type names.
   * When provided, schema native types (from introspection) are normalized
   * before comparison with contract native types during schema verification.
   */
  readonly normalizeNativeType?: NativeTypeNormalizer;

  /**
   * Optional bridging adapter for resolving the existing values of a
   * native enum type from the introspected schema IR. Targets supply
   * this so the family-level schema verifier can walk
   * `PostgresEnumStorageEntry` entries natively without needing to
   * know the target-specific `schema.annotations` shape
   * (e.g. `schema.annotations.pg.storageTypes`).
   */
  readonly resolveExistingEnumValues?: (
    schema: SqlSchemaIR,
    enumType: PostgresEnumStorageEntry,
    namespaceId: string,
  ) => readonly string[] | null;
  /**
   * Optional contract-scoped factory for {@link resolveExistingEnumValues}.
   * Targets that need the contract storage to resolve namespace → DDL schema
   * supply this; the family control instance prefers it over the bare adapter
   * hook when present.
   */
  readonly resolveExistingEnumValuesForContract?: (
    contract: Contract<SqlStorage>,
  ) => (
    schema: SqlSchemaIR,
    enumType: PostgresEnumStorageEntry,
    namespaceId: string,
  ) => readonly string[] | null;

  /**
   * Lower a SQL query AST into a target-flavored `{ sql, params }` payload.
   *
   * Migration tooling (e.g. the `dataTransform` operation) needs to materialize
   * SQL at emit/plan time without instantiating the runtime adapter. The control
   * adapter's `lower` is byte-equivalent to the runtime adapter's `lower` for the
   * same AST and contract, ensuring planned SQL matches what the runtime would
   * emit.
   */
  lower(ast: AnyQueryAst, context: LowererContext<unknown>): LoweredStatement;
}

/**
 * SQL control adapter descriptor interface.
 * Provides a factory method to create control adapter instances.
 *
 * @template TTarget - The target ID (e.g., 'postgres', 'mysql')
 */
export interface SqlControlAdapterDescriptor<TTarget extends string = string> {
  /**
   * Creates a SQL control adapter instance for control-plane operations.
   *
   * Receives the assembled `ControlStack` so adapters can read aggregated
   * metadata (codec lookup, extension contributions) when materializing.
   */
  create(stack: ControlStack<'sql', TTarget>): SqlControlAdapter<TTarget>;
}
