import type {
  Contract,
  ContractMarkerRecord,
  LedgerEntryRecord,
} from '@prisma-next/contract/types';
import type {
  ControlAdapterInstance,
  ControlStack,
} from '@prisma-next/framework-components/control';
import type {
  PostgresEnumStorageEntry,
  SqlControlDriverInstance,
  SqlStorage,
} from '@prisma-next/sql-contract/types';
import type {
  AnyQueryAst,
  DdlNode,
  LoweredStatement,
  LowererContext,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import type { DefaultNormalizer, NativeTypeNormalizer } from './schema-verify/verify-sql-schema';

/**
 * Structural interface for anything that can lower a SQL/DDL AST node to a
 * `LoweredStatement`. `SqlControlAdapter` satisfies this interface; the
 * migration planner and op-factory calls accept `Lowerer` rather than the
 * full `SqlControlAdapter` so they are not coupled to the broader control
 * adapter surface.
 */
export interface Lowerer {
  lower(ast: AnyQueryAst | DdlNode, context: LowererContext<unknown>): LoweredStatement;
}

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
    driver: SqlControlDriverInstance<TTarget>,
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
    driver: SqlControlDriverInstance<TTarget>,
  ): Promise<ReadonlyMap<string, ContractMarkerRecord>>;

  /**
   * Reads the per-migration ledger journal in apply order. When `space` is
   * omitted, returns rows for every space.
   */
  readLedger(
    driver: SqlControlDriverInstance<TTarget>,
    space?: string,
  ): Promise<readonly LedgerEntryRecord[]>;

  /**
   * Inserts the initial marker row for `space` (`INSERT` only). Fails when a
   * row for that space already exists. Used by `sign()` so concurrent first-time
   * stamps cannot silently overwrite each other. `updated_at` is DB-side
   * (`now()` / `datetime('now')`). Mirrors `MongoControlAdapter.initMarker`.
   */
  insertMarker(
    driver: SqlControlDriverInstance<TTarget>,
    space: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
  ): Promise<void>;

  /**
   * Writes the initial marker row for `space` as an upsert (`INSERT … ON
   * CONFLICT (space) DO UPDATE SET …`), so re-stamping a space overwrites the
   * existing row rather than failing. `updated_at` is stamped with a DB-side
   * time expression (`now()` / `datetime('now')`), never an app-side clock.
   */
  initMarker(
    driver: SqlControlDriverInstance<TTarget>,
    space: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
  ): Promise<void>;

  /**
   * Atomically advances the marker row for `space` (compare-and-swap on
   * `core_hash = expectedFrom`). Returns `true` when the swap matched a row,
   * `false` when another process advanced the marker first. `destination.invariants`
   * is written verbatim when supplied (the union/dedupe policy lives upstream)
   * and left untouched when omitted. Mirrors `MongoControlAdapter.updateMarker`.
   */
  updateMarker(
    driver: SqlControlDriverInstance<TTarget>,
    space: string,
    expectedFrom: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
  ): Promise<boolean>;

  /**
   * Appends a ledger entry for `space`. Mirrors `MongoControlAdapter.writeLedgerEntry`.
   * The SQL ledger table keys rows by an autoincrement id and partitions reads
   * by `space`, so `entry.edgeId` carries no dedicated column; `from` / `to`
   * land in `origin_core_hash` / `destination_core_hash`.
   */
  writeLedgerEntry(
    driver: SqlControlDriverInstance<TTarget>,
    space: string,
    entry: {
      readonly edgeId: string;
      readonly from: string;
      readonly to: string;
      readonly migrationName: string;
      readonly migrationHash: string;
      readonly operations: readonly unknown[];
    },
  ): Promise<void>;

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
    driver: SqlControlDriverInstance<TTarget>,
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
   * Ordered DDL queries that bootstrap marker/ledger control tables for migration
   * runners. Postgres includes `CREATE SCHEMA`; SQLite does not.
   */
  bootstrapControlTableQueries(): readonly DdlNode[];

  /**
   * Ordered DDL queries that bootstrap the marker table (and Postgres schema) for
   * `sign` — excludes the ledger table.
   */
  bootstrapSignMarkerQueries(): readonly DdlNode[];

  /**
   * Lower a SQL query AST into a target-flavored `{ sql, params }` payload.
   *
   * Migration tooling (e.g. the `dataTransform` operation) needs to materialize
   * SQL at emit/plan time without instantiating the runtime adapter. The control
   * adapter's `lower` is byte-equivalent to the runtime adapter's `lower` for the
   * same AST and contract, ensuring planned SQL matches what the runtime would
   * emit.
   */
  lower(ast: AnyQueryAst | DdlNode, context: LowererContext<unknown>): LoweredStatement;
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
