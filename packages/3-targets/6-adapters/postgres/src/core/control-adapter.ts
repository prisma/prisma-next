import type { ContractMarkerRecord, LedgerEntryRecord } from '@prisma-next/contract/types';
import {
  parseMarkerRowSafely,
  rethrowMarkerReadError,
  withMarkerReadErrorHandling,
} from '@prisma-next/errors/execution';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { parseContractMarkerRow } from '@prisma-next/family-sql/verify';
import type { CodecLookup, CodecRegistry } from '@prisma-next/framework-components/codec';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { ledgerOriginFromStored } from '@prisma-next/migration-tools/ledger-origin';
import { REFERENTIAL_ACTION_SQL } from '@prisma-next/sql-contract/referential-action-sql';
import type { SqlControlDriverInstance } from '@prisma-next/sql-contract/types';
import type {
  AnyQueryAst,
  CodecRef,
  ContractCodecRegistry,
  DdlColumn,
  DdlNode,
  DdlTableConstraint,
  FunctionColumnDefault,
  LiteralColumnDefault,
  LoweredStatement,
  LowererContext,
  MarkerReadResult,
  SqlExecuteRequest,
} from '@prisma-next/sql-relational-core/ast';
import { isDdlNode } from '@prisma-next/sql-relational-core/ast';
import type {
  PrimaryKey,
  SqlCheckConstraintIRInput,
  SqlColumnIR,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlReferentialAction,
  SqlSchemaIR,
  SqlTableIR,
  SqlUniqueIR,
} from '@prisma-next/sql-schema-ir/types';
import {
  buildControlTableBootstrapQueries,
  buildSignMarkerBootstrapQueries,
} from '@prisma-next/target-postgres/contract-free';
import type {
  AddColumnAction,
  AlterTableActionVisitor,
  DropDefaultAction,
  PostgresAlterTable,
  PostgresCreateSchema,
  PostgresCreateTable,
  PostgresDdlNode,
} from '@prisma-next/target-postgres/ddl';
import { parsePostgresDefault } from '@prisma-next/target-postgres/default-normalizer';
import { normalizeSchemaNativeType } from '@prisma-next/target-postgres/native-type-normalizer';
import { escapeLiteral, quoteIdentifier } from '@prisma-next/target-postgres/sql-utils';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import { encodeControlQueryParams } from './control-codecs';
import {
  execute,
  infoSchemaTables,
  ledger,
  ledgerReadShape,
  marker,
  mergeInvariants,
  NOW,
} from './marker-ledger';
import { renderLoweredSql } from './sql-renderer';
import type { PostgresContract } from './types';

const POSTGRES_MARKER_TABLE = 'prisma_contract.marker';
const POSTGRES_LEDGER_TABLE = 'prisma_contract.ledger';

type PostgresLedgerRow = {
  readonly space: string;
  readonly migration_name: string;
  readonly migration_hash: string;
  readonly origin_core_hash: string | null;
  readonly destination_core_hash: string;
  readonly operations: unknown;
  readonly created_at: Date | string;
};

/**
 * Postgres control plane adapter for control-plane operations like introspection.
 * Provides target-specific implementations for control-plane domain actions.
 */
export class PostgresControlAdapter implements SqlControlAdapter<'postgres'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;

  private readonly codecRegistry: CodecRegistry;

  constructor(codecRegistry: CodecRegistry) {
    this.codecRegistry = codecRegistry;
  }

  /**
   * Target-specific normalizer for raw Postgres default expressions.
   * Used by schema verification to normalize raw defaults before comparison.
   */
  readonly normalizeDefault = parsePostgresDefault;

  /**
   * Target-specific normalizer for Postgres schema native type names.
   * Used by schema verification to normalize introspected type names
   * before comparison with contract native types.
   */
  readonly normalizeNativeType = normalizeSchemaNativeType;

  bootstrapControlTableQueries(): readonly DdlNode[] {
    return buildControlTableBootstrapQueries();
  }

  bootstrapSignMarkerQueries(): readonly DdlNode[] {
    return buildSignMarkerBootstrapQueries();
  }

  /**
   * Lower a SQL query AST into a Postgres-flavored `{ sql, params }` payload.
   *
   * Delegates to the shared `renderLoweredSql` renderer so the control adapter
   * emits byte-identical SQL to `PostgresAdapterImpl.lower()` for the same AST
   * and contract. Used at migration plan/emit time (e.g. by `dataTransform`)
   * without instantiating the runtime adapter.
   */
  lower(ast: AnyQueryAst | PostgresDdlNode, context: LowererContext<unknown>): LoweredStatement {
    if (isDdlNode(ast)) {
      throw new Error(
        'lower() cannot lower DDL: DDL default literals require inline codec encoding, which is async. Use lowerToExecuteRequest().',
      );
    }
    return renderLoweredSql(
      ast,
      blindCast<PostgresContract, 'caller must supply a matching PostgresContract'>(
        context.contract,
      ),
      this.codecRegistry,
    );
  }

  /**
   * Lower an AST all the way to a driver-ready statement. For DDL nodes,
   * literal column defaults are formatted as inline SQL with proper quoting and
   * `::nativeType` cast suffixes. For query ASTs, params are kept as `$N`
   * placeholders; wire values go in `params`. Does NOT call `this.lower()` —
   * independent implementation.
   */
  async lowerToExecuteRequest(
    ast: AnyQueryAst | PostgresDdlNode,
    context?: LowererContext<unknown>,
  ): Promise<SqlExecuteRequest> {
    if (isDdlNode(ast)) {
      return pgRenderDdlExecuteRequest(
        blindCast<PostgresDdlNode, 'isDdlNode guard'>(ast),
        this.codecRegistry,
      );
    }
    const contract = blindCast<PostgresContract, 'Caller must supply matching contract'>(
      context?.contract,
    );
    const lowered = renderLoweredSql(ast, contract, this.codecRegistry);
    const codecRegistry = blindCast<
      ContractCodecRegistry,
      'framework CodecRegistry: its descriptors materialise SQL codecs; the framework Codec type erases to BaseCodec at this boundary'
    >(this.codecRegistry);
    const params = await encodeControlQueryParams(lowered, ast, codecRegistry);
    return { sql: lowered.sql, params };
  }

  /**
   * Reads the contract marker from `prisma_contract.marker`. Probes
   * `information_schema.tables` first so a fresh database (where the
   * `prisma_contract` schema doesn't yet exist) returns `null` instead of a
   * "relation does not exist" error — some Postgres wire-protocol clients
   * (e.g. PGlite's TCP proxy) don't fully recover from extended-protocol
   * parse errors, so we probe before reading.
   */
  async readMarker(
    driver: SqlControlDriverInstance<'postgres'>,
    space: string,
  ): Promise<ContractMarkerRecord | null> {
    const result = await this.readMarkerDiscriminated(driver, space);
    return result.kind === 'present' ? result.record : null;
  }

  async readMarkerDiscriminated(
    driver: SqlControlDriverInstance<'postgres'>,
    space: string,
  ): Promise<MarkerReadResult> {
    const markerContext = { space, markerLocation: POSTGRES_MARKER_TABLE };
    return withMarkerReadErrorHandling(() => this.readMarkerResult(driver, space), markerContext);
  }

  /**
   * Reads every row from `prisma_contract.marker` and returns them keyed
   * by `space`. Mirrors the existence probe in {@link readMarker}: a
   * fresh database without the `prisma_contract` schema returns an empty
   * map rather than raising "relation does not exist".
   */
  async readAllMarkers(
    driver: SqlControlDriverInstance<'postgres'>,
  ): Promise<ReadonlyMap<string, ContractMarkerRecord>> {
    const markerContext = { space: APP_SPACE_ID, markerLocation: POSTGRES_MARKER_TABLE };
    return withMarkerReadErrorHandling(() => this.readAllMarkersResult(driver), markerContext);
  }

  private async readAllMarkersResult(
    driver: SqlControlDriverInstance<'postgres'>,
  ): Promise<ReadonlyMap<string, ContractMarkerRecord>> {
    const lower = (query: AnyQueryAst) => this.lower(query, { contract: undefined });
    const probe = infoSchemaTables
      .select(infoSchemaTables.table_schema)
      .where(
        infoSchemaTables.table_schema
          .eq('prisma_contract')
          .and(infoSchemaTables.table_name.eq('marker')),
      )
      .build();
    const exists = await execute(lower, driver, probe);
    if (exists.length === 0) {
      return new Map();
    }

    await this.assertMarkerTableHasSpaceColumn(driver, APP_SPACE_ID);

    const fetch = marker
      .select(
        marker.space,
        marker.core_hash,
        marker.profile_hash,
        marker.contract_json,
        marker.canonical_version,
        marker.updated_at,
        marker.app_tag,
        marker.meta,
        marker.invariants,
      )
      .build();
    const rawRows = await execute(lower, driver, fetch);
    const rows = blindCast<
      ReadonlyArray<{ space: string } & Record<string, unknown>>,
      'Driver returns rows shaped by SELECT'
    >(rawRows);

    const out = new Map<string, ContractMarkerRecord>();
    for (const row of rows) {
      out.set(
        row.space,
        parseMarkerRowSafely(row, parseContractMarkerRow, {
          space: row.space,
          markerLocation: POSTGRES_MARKER_TABLE,
        }),
      );
    }
    return out;
  }

  /**
   * Reads per-migration ledger rows from `prisma_contract.ledger` in apply
   * order. Probes `information_schema.tables` first so a fresh database
   * without the ledger table returns `[]` instead of raising "relation does
   * not exist".
   */
  async readLedger(
    driver: SqlControlDriverInstance<'postgres'>,
    space?: string,
  ): Promise<readonly LedgerEntryRecord[]> {
    const ledgerContext = { space: space ?? '*', markerLocation: POSTGRES_LEDGER_TABLE };
    return withMarkerReadErrorHandling(() => this.readLedgerResult(driver, space), ledgerContext);
  }

  private async readLedgerResult(
    driver: SqlControlDriverInstance<'postgres'>,
    space: string | undefined,
  ): Promise<readonly LedgerEntryRecord[]> {
    const lower = (query: AnyQueryAst) => this.lower(query, { contract: undefined });
    const probe = infoSchemaTables
      .select(infoSchemaTables.table_schema)
      .where(
        infoSchemaTables.table_schema
          .eq('prisma_contract')
          .and(infoSchemaTables.table_name.eq('ledger')),
      )
      .build();
    const exists = await execute(lower, driver, probe);
    if (exists.length === 0) {
      return [];
    }

    const base = ledgerReadShape.select(
      ledgerReadShape.space,
      ledgerReadShape.migration_name,
      ledgerReadShape.migration_hash,
      ledgerReadShape.origin_core_hash,
      ledgerReadShape.destination_core_hash,
      ledgerReadShape.operations,
      ledgerReadShape.created_at,
    );
    const filtered = space !== undefined ? base.where(ledgerReadShape.space.eq(space)) : base;
    const rawRows = await execute(lower, driver, filtered.orderBy(ledgerReadShape.id).build());
    const rows = blindCast<readonly PostgresLedgerRow[], 'Driver returns rows shaped by SELECT'>(
      rawRows,
    );

    return rows.map((row) => {
      const appliedAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
      return {
        space: row.space,
        migrationName: row.migration_name,
        migrationHash: row.migration_hash,
        from: ledgerOriginFromStored(row.origin_core_hash),
        to: row.destination_core_hash,
        appliedAt,
        operationCount: Array.isArray(row.operations) ? row.operations.length : 0,
      };
    });
  }

  /**
   * Stamps the initial marker row for `space` via the shared contract-free DML
   * builder, lowered through {@link lower} and executed on the driver. See the
   * `SqlControlAdapter.initMarker` contract.
   */
  async insertMarker(
    driver: SqlControlDriverInstance<'postgres'>,
    space: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
  ): Promise<void> {
    await execute(
      (query) => this.lower(query, { contract: undefined }),
      driver,
      marker
        .insert({
          space,
          core_hash: destination.storageHash,
          profile_hash: destination.profileHash,
          contract_json: null,
          canonical_version: null,
          updated_at: NOW,
          app_tag: null,
          meta: {},
          invariants: destination.invariants ?? [],
        })
        .build(),
    );
  }

  async initMarker(
    driver: SqlControlDriverInstance<'postgres'>,
    space: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
  ): Promise<void> {
    await execute(
      (query) => this.lower(query, { contract: undefined }),
      driver,
      marker
        .upsert({
          space,
          core_hash: destination.storageHash,
          profile_hash: destination.profileHash,
          contract_json: null,
          canonical_version: null,
          updated_at: NOW,
          app_tag: null,
          meta: {},
          invariants: destination.invariants ?? [],
        })
        .onConflict(marker.space)
        .doUpdate((excluded) => ({
          core_hash: excluded.core_hash,
          profile_hash: excluded.profile_hash,
          contract_json: excluded.contract_json,
          canonical_version: excluded.canonical_version,
          updated_at: NOW,
          app_tag: excluded.app_tag,
          meta: excluded.meta,
          invariants: excluded.invariants,
        }))
        .build(),
    );
  }

  /**
   * Compare-and-swap advance of the marker row for `space`. See the
   * `SqlControlAdapter.updateMarker` contract.
   */
  async updateMarker(
    driver: SqlControlDriverInstance<'postgres'>,
    space: string,
    expectedFrom: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
  ): Promise<boolean> {
    const currentInvariants =
      destination.invariants === undefined
        ? []
        : ((await this.readMarker(driver, space))?.invariants ?? []);
    const mergedInvariants =
      destination.invariants === undefined
        ? undefined
        : mergeInvariants(currentInvariants, destination.invariants);

    const query = marker
      .update()
      .set({
        core_hash: destination.storageHash,
        profile_hash: destination.profileHash,
        updated_at: NOW,
        ...(mergedInvariants !== undefined ? { invariants: mergedInvariants } : {}),
      })
      .where(marker.space.eq(space).and(marker.core_hash.eq(expectedFrom)))
      .returning(marker.space)
      .build();

    const rows = await execute((q) => this.lower(q, { contract: undefined }), driver, query);
    return rows.length > 0;
  }

  /**
   * Appends a ledger entry for `space`. See the
   * `SqlControlAdapter.writeLedgerEntry` contract.
   */
  async writeLedgerEntry(
    driver: SqlControlDriverInstance<'postgres'>,
    space: string,
    entry: {
      readonly edgeId: string;
      readonly from: string;
      readonly to: string;
      readonly migrationName: string;
      readonly migrationHash: string;
      readonly operations: readonly unknown[];
    },
  ): Promise<void> {
    await execute(
      (query) => this.lower(query, { contract: undefined }),
      driver,
      ledger
        .insert({
          space,
          migration_name: entry.migrationName,
          migration_hash: entry.migrationHash,
          origin_core_hash: entry.from,
          destination_core_hash: entry.to,
          operations: entry.operations,
        })
        .build(),
    );
  }

  private async assertMarkerTableHasSpaceColumn(
    driver: SqlControlDriverInstance<'postgres'>,
    space: string,
  ): Promise<void> {
    const result = await driver.query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_schema = 'prisma_contract'
          and table_name = 'marker'`,
    );
    const rows = result.rows;
    if (rows.length === 0) {
      return;
    }
    if (!rows.every((row) => typeof row.column_name === 'string')) {
      return;
    }
    if (rows.some((row) => row.column_name === 'space')) {
      return;
    }
    rethrowMarkerReadError(new Error('column "space" does not exist'), {
      space,
      markerLocation: POSTGRES_MARKER_TABLE,
    });
  }

  private async readMarkerResult(driver: SqlControlDriverInstance<'postgres'>, space: string) {
    const lower = (query: AnyQueryAst) => this.lower(query, { contract: undefined });
    const probe = infoSchemaTables
      .select(infoSchemaTables.table_schema)
      .where(
        infoSchemaTables.table_schema
          .eq('prisma_contract')
          .and(infoSchemaTables.table_name.eq('marker')),
      )
      .build();
    const exists = await execute(lower, driver, probe);
    if (exists.length === 0) return { kind: 'no-table' as const };

    await this.assertMarkerTableHasSpaceColumn(driver, space);

    const fetch = marker
      .select(
        marker.core_hash,
        marker.profile_hash,
        marker.contract_json,
        marker.canonical_version,
        marker.updated_at,
        marker.app_tag,
        marker.meta,
        marker.invariants,
      )
      .where(marker.space.eq(space))
      .build();
    const result = await execute(lower, driver, fetch);
    const row = result[0];
    if (!row) return { kind: 'absent' as const };
    return { kind: 'present' as const, record: parseContractMarkerRow(row) };
  }

  /**
   * Introspects a Postgres database schema and returns a raw SqlSchemaIR.
   *
   * This is a pure schema discovery operation that queries the Postgres catalog
   * and returns the schema structure without type mapping or contract enrichment.
   * Type mapping and enrichment are handled separately by enrichment helpers.
   *
   * When `contract` is provided and its storage declares more than one
   * namespace (or any explicit bound namespace), the adapter walks every
   * declared namespace and merges the per-schema introspection results
   * into a single `SqlSchemaIR`. `UNBOUND_NAMESPACE_ID` resolves to the
   * connection's `current_schema()` so late-bound tables follow the
   * runtime `search_path`. When no contract is passed, the adapter falls
   * back to introspecting the single `schema` argument (defaulting to
   * `'public'`).
   *
   * Uses batched queries to minimize database round trips (6 queries per
   * schema walked).
   *
   * @param driver - SqlControlDriverInstance<'postgres'> instance for executing queries
   * @param contract - Optional contract for contract-guided introspection (multi-namespace walk, filtering)
   * @param schema - Schema name to introspect when no contract is provided (defaults to 'public')
   * @returns Promise resolving to SqlSchemaIR representing the live database schema
   */
  async introspect(
    driver: SqlControlDriverInstance<'postgres'>,
    contract?: unknown,
    schema = 'public',
  ): Promise<SqlSchemaIR> {
    const declaredNamespaces = extractContractNamespaceIds(contract);
    const ir =
      declaredNamespaces.length > 0
        ? await this.introspectNamespaces(driver, declaredNamespaces)
        : await this.introspectSchema(driver, schema);
    // Capture the list of non-system schemas so downstream planners
    // (e.g. `verifyPostgresNamespacePresence`) can determine which
    // contract-declared namespaces need a `CREATE SCHEMA` before the
    // table DDL.
    const existingSchemas = await this.listExistingSchemas(driver);
    const annotations = ir.annotations ?? {};
    const pg = (annotations as { pg?: Record<string, unknown> }).pg ?? {};
    return {
      ...ir,
      annotations: {
        ...annotations,
        pg: { ...pg, existingSchemas },
      },
    };
  }

  /**
   * Lists every non-system schema present in the connected database.
   * The introspection consumer (`verifyPostgresNamespacePresence`)
   * treats the result as the authoritative ground truth — declared
   * namespaces whose `ddlSchemaName` is missing from this list become
   * `missing_schema` issues, and the planner emits the matching
   * `CREATE SCHEMA` before table DDL.
   */
  private async listExistingSchemas(
    driver: SqlControlDriverInstance<'postgres'>,
  ): Promise<readonly string[]> {
    const result = await driver.query<{ nspname: string }>(
      `SELECT nspname
       FROM pg_catalog.pg_namespace
       WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND nspname NOT LIKE 'pg_temp_%'
         AND nspname NOT LIKE 'pg_toast_temp_%'
       ORDER BY nspname`,
    );
    return result.rows.map((row) => row.nspname);
  }

  /**
   * Walks every declared namespace, resolving `UNBOUND_NAMESPACE_ID` to
   * the connection's `current_schema()`, and merges the per-schema results
   * into a single `SqlSchemaIR`. The merged `tables` map is flat (keyed by
   * table name) so callers that look up by `tableName` see every contract
   * table regardless of which namespace it lives in.
   */
  private async introspectNamespaces(
    driver: SqlControlDriverInstance<'postgres'>,
    namespaceIds: readonly string[],
  ): Promise<SqlSchemaIR> {
    const resolvedSchemas: string[] = [];
    for (const id of namespaceIds) {
      if (id === UNBOUND_NAMESPACE_ID) {
        const { rows } = await driver.query<{ current_schema: string }>(
          'SELECT current_schema() AS current_schema',
        );
        resolvedSchemas.push(rows[0]?.current_schema ?? 'public');
      } else {
        resolvedSchemas.push(id);
      }
    }
    const uniqueSchemas = Array.from(new Set(resolvedSchemas));

    // Walk schemas sequentially: every introspectSchema call shares the one
    // control connection, so a parallel walk only serialises behind the wire
    // protocol and trips pg's "already executing a query" deprecation.
    const perSchema: SqlSchemaIR[] = [];
    for (const schema of uniqueSchemas) {
      perSchema.push(await this.introspectSchema(driver, schema));
    }

    const mergedTables: Record<string, SqlTableIR> = {};
    for (const ir of perSchema) {
      for (const [tableName, table] of Object.entries(ir.tables)) {
        mergedTables[tableName] = table;
      }
    }

    const firstAnnotations = perSchema[0]?.annotations;
    const firstPg =
      blindCast<Record<string, unknown> | undefined, 'pg annotation envelope index slot'>(
        firstAnnotations?.['pg'],
      ) ?? {};
    return {
      tables: mergedTables,
      ...ifDefined('annotations', {
        ...firstAnnotations,
        pg: { ...firstPg },
      }),
    };
  }

  /**
   * Introspects a single Postgres schema and returns a raw SqlSchemaIR
   * containing only the tables in that schema. Used by `introspect` as
   * the per-namespace walk.
   */
  private async introspectSchema(
    driver: SqlControlDriverInstance<'postgres'>,
    schema: string,
  ): Promise<SqlSchemaIR> {
    // Issue the schema-wide queries one at a time. A single control connection
    // serialises queries anyway, so Promise.all buys no parallelism here and
    // makes pg emit a "client is already executing a query" deprecation. One
    // schema-wide query per relation kind keeps this to 7 round-trips, not 6T+1.
    // Query all tables
    const tablesResult = await driver.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = $1
           AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
      [schema],
    );
    // Query all columns for all tables in schema
    const columnsResult = await driver.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
      character_maximum_length: number | null;
      numeric_precision: number | null;
      numeric_scale: number | null;
      column_default: string | null;
      formatted_type: string | null;
    }>(
      `SELECT
           c.table_name,
           column_name,
           data_type,
           udt_name,
           is_nullable,
           character_maximum_length,
           numeric_precision,
           numeric_scale,
           column_default,
           format_type(a.atttypid, a.atttypmod) AS formatted_type
         FROM information_schema.columns c
         JOIN pg_catalog.pg_class cl
           ON cl.relname = c.table_name
         JOIN pg_catalog.pg_namespace ns
           ON ns.nspname = c.table_schema
           AND ns.oid = cl.relnamespace
         JOIN pg_catalog.pg_attribute a
           ON a.attrelid = cl.oid
           AND a.attname = c.column_name
           AND a.attnum > 0
           AND NOT a.attisdropped
         WHERE c.table_schema = $1
         ORDER BY c.table_name, c.ordinal_position`,
      [schema],
    );
    // Query all primary keys for all tables in schema
    const pkResult = await driver.query<{
      table_name: string;
      constraint_name: string;
      column_name: string;
      ordinal_position: number;
    }>(
      `SELECT
           tc.table_name,
           tc.constraint_name,
           kcu.column_name,
           kcu.ordinal_position
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
           AND tc.table_name = kcu.table_name
         WHERE tc.table_schema = $1
           AND tc.constraint_type = 'PRIMARY KEY'
         ORDER BY tc.table_name, kcu.ordinal_position`,
      [schema],
    );
    // Query all foreign keys for all tables in schema, including referential actions.
    // Uses pg_catalog for correct positional pairing of composite FK columns
    // (information_schema.constraint_column_usage lacks ordinal_position,
    // which causes Cartesian products for multi-column FKs).
    const fkResult = await driver.query<{
      table_name: string;
      constraint_name: string;
      column_name: string;
      ordinal_position: number;
      referenced_table_schema: string;
      referenced_table_name: string;
      referenced_column_name: string;
      delete_rule: string;
      update_rule: string;
    }>(
      `SELECT
           tc.table_name,
           tc.constraint_name,
           kcu.column_name,
           kcu.ordinal_position,
           ref_ns.nspname AS referenced_table_schema,
           ref_cl.relname AS referenced_table_name,
           ref_att.attname AS referenced_column_name,
           rc.delete_rule,
           rc.update_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
           AND tc.table_name = kcu.table_name
         JOIN pg_catalog.pg_constraint pgc
           ON pgc.conname = tc.constraint_name
           AND pgc.connamespace = (
             SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = tc.table_schema
           )
         JOIN pg_catalog.pg_class ref_cl
           ON ref_cl.oid = pgc.confrelid
         JOIN pg_catalog.pg_namespace ref_ns
           ON ref_ns.oid = ref_cl.relnamespace
         JOIN pg_catalog.pg_attribute ref_att
           ON ref_att.attrelid = pgc.confrelid
           AND ref_att.attnum = pgc.confkey[kcu.ordinal_position]
         JOIN information_schema.referential_constraints rc
           ON rc.constraint_name = tc.constraint_name
           AND rc.constraint_schema = tc.table_schema
         WHERE tc.table_schema = $1
           AND tc.constraint_type = 'FOREIGN KEY'
         ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position`,
      [schema],
    );
    // Query all unique constraints for all tables in schema (excluding PKs)
    const uniqueResult = await driver.query<{
      table_name: string;
      constraint_name: string;
      column_name: string;
      ordinal_position: number;
    }>(
      `SELECT
           tc.table_name,
           tc.constraint_name,
           kcu.column_name,
           kcu.ordinal_position
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
           AND tc.table_name = kcu.table_name
         WHERE tc.table_schema = $1
           AND tc.constraint_type = 'UNIQUE'
         ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position`,
      [schema],
    );
    // Query all indexes for all tables in schema (excluding constraints).
    // `index_position` is the column's position within the index (1-based),
    // derived from `pg_index.indkey` so composite indexes round-trip with
    // their declared column order intact.
    const indexResult = await driver.query<{
      tablename: string;
      indexname: string;
      indisunique: boolean;
      attname: string | null;
      index_position: number;
      amname: string | null;
      reloptions: string[] | null;
    }>(
      // `ix.indkey` is an int2vector of column numbers in the order the
      // columns appear in the index definition. Unnest it WITH ORDINALITY
      // so each (index, column) row carries its position in the index,
      // then ORDER BY that position. Without this the rows come back in
      // table-column order (`a.attnum`), which silently shuffles the
      // columns of any composite index whose index order differs from
      // the table order — verification compares against the contract
      // with order-sensitive equality and reports a spurious
      // `index_mismatch`.
      `SELECT
           i.tablename,
           i.indexname,
           ix.indisunique,
           a.attname,
           k.ord AS index_position,
           am.amname,
           ic.reloptions
         FROM pg_indexes i
         JOIN pg_class ic ON ic.relname = i.indexname
         JOIN pg_namespace ins ON ins.oid = ic.relnamespace AND ins.nspname = $1
         JOIN pg_index ix ON ix.indexrelid = ic.oid
         JOIN pg_am am ON am.oid = ic.relam
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_namespace tn ON tn.oid = t.relnamespace AND tn.nspname = $1
         JOIN LATERAL unnest(ix.indkey::int[]) WITH ORDINALITY AS k(attnum, ord) ON true
         LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum AND a.attnum > 0
         WHERE i.schemaname = $1
           AND NOT EXISTS (
             SELECT 1
             FROM information_schema.table_constraints tc
             WHERE tc.table_schema = $1
               AND tc.table_name = i.tablename
               AND tc.constraint_name = i.indexname
           )
         ORDER BY i.tablename, i.indexname, k.ord`,
      [schema],
    );
    // Query all check constraints for enum-restricted columns.
    // `pg_get_constraintdef(oid)` returns the predicate including the
    // `CHECK (...)` wrapper. We parse the inner predicate to extract
    // the column name and permitted values.
    //
    // Scope: only parses the `= ANY (ARRAY[...])` and `IN (...)` shapes
    // that this slice emits. Arbitrary SQL predicates are left as-is
    // and will not produce check IR entries (they are silently skipped).
    const checkResult = await driver.query<{
      table_name: string;
      constraint_name: string;
      constraintdef: string;
    }>(
      `SELECT
           cl.relname AS table_name,
           c.conname AS constraint_name,
           pg_get_constraintdef(c.oid) AS constraintdef
         FROM pg_catalog.pg_constraint c
         JOIN pg_catalog.pg_class cl ON cl.oid = c.conrelid
         JOIN pg_catalog.pg_namespace ns ON ns.oid = cl.relnamespace
         WHERE ns.nspname = $1
           AND c.contype = 'c'
         ORDER BY cl.relname, c.conname`,
      [schema],
    );

    // Group results by table name for efficient lookup
    const columnsByTable = groupBy(columnsResult.rows, 'table_name');
    const pksByTable = groupBy(pkResult.rows, 'table_name');
    const fksByTable = groupBy(fkResult.rows, 'table_name');
    const uniquesByTable = groupBy(uniqueResult.rows, 'table_name');
    const indexesByTable = groupBy(indexResult.rows, 'tablename');
    const checksByTable = groupBy(checkResult.rows, 'table_name');

    // Get set of PK constraint names per table (to exclude from uniques)
    const pkConstraintsByTable = new Map<string, Set<string>>();
    for (const row of pkResult.rows) {
      let constraints = pkConstraintsByTable.get(row.table_name);
      if (!constraints) {
        constraints = new Set();
        pkConstraintsByTable.set(row.table_name, constraints);
      }
      constraints.add(row.constraint_name);
    }

    const tables: Record<string, SqlTableIR> = {};

    for (const tableRow of tablesResult.rows) {
      const tableName = tableRow.table_name;

      // Process columns for this table
      const columns: Record<string, SqlColumnIR> = {};
      for (const colRow of columnsByTable.get(tableName) ?? []) {
        let nativeType = colRow.udt_name;
        const formattedType = colRow.formatted_type
          ? normalizeFormattedType(colRow.formatted_type, colRow.data_type, colRow.udt_name)
          : null;
        if (formattedType) {
          nativeType = formattedType;
        } else if (colRow.data_type === 'character varying' || colRow.data_type === 'character') {
          if (colRow.character_maximum_length) {
            nativeType = `${colRow.data_type}(${colRow.character_maximum_length})`;
          } else {
            nativeType = colRow.data_type;
          }
        } else if (colRow.data_type === 'numeric' || colRow.data_type === 'decimal') {
          if (colRow.numeric_precision && colRow.numeric_scale !== null) {
            nativeType = `${colRow.data_type}(${colRow.numeric_precision},${colRow.numeric_scale})`;
          } else if (colRow.numeric_precision) {
            nativeType = `${colRow.data_type}(${colRow.numeric_precision})`;
          } else {
            nativeType = colRow.data_type;
          }
        } else {
          nativeType = colRow.udt_name || colRow.data_type;
        }

        columns[colRow.column_name] = {
          name: colRow.column_name,
          nativeType,
          nullable: colRow.is_nullable === 'YES',
          ...ifDefined('default', colRow.column_default ?? undefined),
        };
      }

      // Process primary key
      const pkRows = [...(pksByTable.get(tableName) ?? [])];
      const primaryKeyColumns = pkRows
        .sort((a, b) => a.ordinal_position - b.ordinal_position)
        .map((row) => row.column_name);
      const primaryKey: PrimaryKey | undefined =
        primaryKeyColumns.length > 0
          ? {
              columns: primaryKeyColumns,
              ...(pkRows[0]?.constraint_name ? { name: pkRows[0].constraint_name } : {}),
            }
          : undefined;

      // Process foreign keys
      const foreignKeysMap = new Map<
        string,
        {
          columns: string[];
          referencedTable: string;
          referencedSchema: string;
          referencedColumns: string[];
          name: string;
          deleteRule: string;
          updateRule: string;
        }
      >();
      for (const fkRow of fksByTable.get(tableName) ?? []) {
        const existing = foreignKeysMap.get(fkRow.constraint_name);
        if (existing) {
          existing.columns.push(fkRow.column_name);
          existing.referencedColumns.push(fkRow.referenced_column_name);
        } else {
          foreignKeysMap.set(fkRow.constraint_name, {
            columns: [fkRow.column_name],
            referencedTable: fkRow.referenced_table_name,
            referencedSchema: fkRow.referenced_table_schema,
            referencedColumns: [fkRow.referenced_column_name],
            name: fkRow.constraint_name,
            deleteRule: fkRow.delete_rule,
            updateRule: fkRow.update_rule,
          });
        }
      }
      const foreignKeys: readonly SqlForeignKeyIR[] = Array.from(foreignKeysMap.values()).map(
        (fk) => ({
          columns: Object.freeze([...fk.columns]) as readonly string[],
          referencedTable: fk.referencedTable,
          referencedSchema: fk.referencedSchema,
          referencedColumns: Object.freeze([...fk.referencedColumns]) as readonly string[],
          name: fk.name,
          ...ifDefined('onDelete', mapReferentialAction(fk.deleteRule)),
          ...ifDefined('onUpdate', mapReferentialAction(fk.updateRule)),
        }),
      );

      // Process unique constraints (excluding those that are also PKs)
      const pkConstraints = pkConstraintsByTable.get(tableName) ?? new Set();
      const uniquesMap = new Map<string, { columns: string[]; name: string }>();
      for (const uniqueRow of uniquesByTable.get(tableName) ?? []) {
        // Skip if this constraint is also a primary key
        if (pkConstraints.has(uniqueRow.constraint_name)) {
          continue;
        }
        const existing = uniquesMap.get(uniqueRow.constraint_name);
        if (existing) {
          existing.columns.push(uniqueRow.column_name);
        } else {
          uniquesMap.set(uniqueRow.constraint_name, {
            columns: [uniqueRow.column_name],
            name: uniqueRow.constraint_name,
          });
        }
      }
      const uniques: readonly SqlUniqueIR[] = Array.from(uniquesMap.values()).map((uq) => ({
        columns: Object.freeze([...uq.columns]) as readonly string[],
        name: uq.name,
      }));

      // Process indexes
      const indexesMap = new Map<
        string,
        {
          columns: string[];
          name: string;
          unique: boolean;
          type: string | undefined;
          options: Record<string, string> | undefined;
        }
      >();
      for (const idxRow of indexesByTable.get(tableName) ?? []) {
        if (!idxRow.attname) {
          continue;
        }
        const existing = indexesMap.get(idxRow.indexname);
        if (existing) {
          existing.columns.push(idxRow.attname);
        } else {
          // Drop btree (the Postgres default) so a contract index without an
          // explicit type matches a default-method introspected index without
          // forcing DROP+CREATE on every plan.
          const indexType = idxRow.amname && idxRow.amname !== 'btree' ? idxRow.amname : undefined;
          const indexOptions = parsePgReloptions(idxRow.reloptions, idxRow.indexname);
          indexesMap.set(idxRow.indexname, {
            columns: [idxRow.attname],
            name: idxRow.indexname,
            unique: idxRow.indisunique,
            type: indexType,
            options: indexOptions,
          });
        }
      }
      const indexes: readonly SqlIndexIR[] = Array.from(indexesMap.values()).map((idx) => ({
        columns: Object.freeze([...idx.columns]) as readonly string[],
        name: idx.name,
        unique: idx.unique,
        ...(idx.type !== undefined && { type: idx.type }),
        ...(idx.options !== undefined && { options: idx.options }),
      }));

      // Process check constraints — parse each predicate into column + value set.
      // Only the two shapes emitted by this slice are recognised; free-form
      // predicates are silently skipped (they won't produce check IR entries).
      const checksForTable: SqlCheckConstraintIRInput[] = [];
      for (const checkRow of checksByTable.get(tableName) ?? []) {
        const parsed = parseCheckConstraintDef(checkRow.constraintdef);
        if (parsed) {
          checksForTable.push({
            name: checkRow.constraint_name,
            column: parsed.column,
            permittedValues: parsed.permittedValues,
          });
        }
      }

      tables[tableName] = {
        name: tableName,
        columns,
        ...ifDefined('primaryKey', primaryKey),
        foreignKeys,
        uniques,
        indexes,
        ...ifDefined('checks', checksForTable.length > 0 ? checksForTable : undefined),
      };
    }

    const nativeEnumResult = await driver.query<{ typname: string }>(
      `SELECT t.typname
         FROM pg_catalog.pg_type t
         JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
         WHERE t.typtype = 'e'
           AND n.nspname = $1
         ORDER BY t.typname`,
      [schema],
    );
    const nativeEnumTypeNames = nativeEnumResult.rows.map((r) => r.typname);

    const annotations = {
      pg: {
        schema,
        version: await this.getPostgresVersion(driver),
        ...(nativeEnumTypeNames.length > 0 && { nativeEnumTypeNames }),
      },
    };

    return {
      tables,
      annotations,
    };
  }

  /**
   * Gets the Postgres version from the database.
   */
  private async getPostgresVersion(driver: SqlControlDriverInstance<'postgres'>): Promise<string> {
    const result = await driver.query<{ version: string }>('SELECT version() AS version', []);
    const versionString = result.rows[0]?.version ?? '';
    // Extract version number from "PostgreSQL 15.1 ..." format
    const match = versionString.match(/PostgreSQL (\d+\.\d+)/);
    return match?.[1] ?? 'unknown';
  }
}

/**
 * Extracts the namespace coordinate ids declared on a contract's storage,
 * or returns an empty array when no contract (or no storage / namespaces)
 * is present. Used by `PostgresControlAdapter.introspect` to decide
 * between the multi-namespace walk and the single-schema fallback.
 */
function extractContractNamespaceIds(contract: unknown): readonly string[] {
  if (contract === null || typeof contract !== 'object') return [];
  const storage = (contract as { storage?: unknown }).storage;
  if (storage === null || typeof storage !== 'object') return [];
  const namespaces = (storage as { namespaces?: unknown }).namespaces;
  if (namespaces === null || typeof namespaces !== 'object') return [];
  return Object.keys(namespaces as Record<string, unknown>);
}

function normalizeFormattedType(formattedType: string, dataType: string, udtName: string): string {
  if (formattedType === 'integer') {
    return 'int4';
  }
  if (formattedType === 'smallint') {
    return 'int2';
  }
  if (formattedType === 'bigint') {
    return 'int8';
  }
  if (formattedType === 'real') {
    return 'float4';
  }
  if (formattedType === 'double precision') {
    return 'float8';
  }
  if (formattedType === 'boolean') {
    return 'bool';
  }
  if (formattedType.startsWith('varchar')) {
    return formattedType.replace('varchar', 'character varying');
  }
  if (formattedType.startsWith('bpchar')) {
    return formattedType.replace('bpchar', 'character');
  }
  if (formattedType.startsWith('varbit')) {
    return formattedType.replace('varbit', 'bit varying');
  }
  if (dataType === 'timestamp with time zone' || udtName === 'timestamptz') {
    return formattedType.replace('timestamp', 'timestamptz').replace(' with time zone', '').trim();
  }
  if (dataType === 'timestamp without time zone' || udtName === 'timestamp') {
    return formattedType.replace(' without time zone', '').trim();
  }
  if (dataType === 'time with time zone' || udtName === 'timetz') {
    return formattedType.replace('time', 'timetz').replace(' with time zone', '').trim();
  }
  if (dataType === 'time without time zone' || udtName === 'time') {
    return formattedType.replace(' without time zone', '').trim();
  }
  // Only dataType === 'USER-DEFINED' should ever be quoted, but this should be safe without
  // checking that explicitly either way
  if (formattedType.startsWith('"') && formattedType.endsWith('"')) {
    return formattedType.slice(1, -1);
  }
  return formattedType;
}

/**
 * The five standard PostgreSQL referential action rules as returned by
 * `information_schema.referential_constraints.delete_rule` / `update_rule`.
 */
type PgReferentialActionRule = 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT';

const PG_REFERENTIAL_ACTION_MAP: Record<PgReferentialActionRule, SqlReferentialAction> = {
  'NO ACTION': 'noAction',
  RESTRICT: 'restrict',
  CASCADE: 'cascade',
  'SET NULL': 'setNull',
  'SET DEFAULT': 'setDefault',
};

/**
 * Maps a Postgres referential action rule to the canonical SqlReferentialAction.
 * Returns undefined for 'NO ACTION' (the database default) to keep the IR sparse.
 * Throws for unrecognized rules to prevent silent data loss.
 */
function mapReferentialAction(rule: string): SqlReferentialAction | undefined {
  const mapped = PG_REFERENTIAL_ACTION_MAP[rule as PgReferentialActionRule];
  if (mapped === undefined) {
    throw new Error(
      `Unknown PostgreSQL referential action rule: "${rule}". Expected one of: NO ACTION, RESTRICT, CASCADE, SET NULL, SET DEFAULT.`,
    );
  }
  if (mapped === 'noAction') return undefined;
  return mapped;
}

/**
 * Groups an array of objects by a specified key.
 * Returns a Map for O(1) lookup by group key.
 */
/**
 * Parses a `pg_class.reloptions` array into a `Record<string, string>`.
 *
 * Postgres returns reloptions as a `text[]` whose entries are `key=value`
 * strings; the value side is always a string regardless of the underlying
 * scalar type. The verifier compares contract options to introspected
 * options after coercing both sides to strings, so keeping the raw text
 * here is correct.
 *
 * Returns `undefined` when the input is null/empty (no WITH clause).
 */
export function parsePgReloptions(
  reloptions: readonly string[] | null,
  indexName: string,
): Record<string, string> | undefined {
  if (!reloptions || reloptions.length === 0) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const entry of reloptions) {
    const eq = entry.indexOf('=');
    if (eq === -1) {
      throw new Error(
        `Postgres introspection: malformed reloption entry "${entry}" on index "${indexName}" (expected "key=value")`,
      );
    }
    const key = entry.slice(0, eq);
    const value = entry.slice(eq + 1);
    result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function groupBy<T, K extends keyof T>(items: readonly T[], key: K): Map<T[K], T[]> {
  const map = new Map<T[K], T[]>();
  for (const item of items) {
    const groupKey = item[key];
    let group = map.get(groupKey);
    if (!group) {
      group = [];
      map.set(groupKey, group);
    }
    group.push(item);
  }
  return map;
}

/**
 * Parses a Postgres check-constraint definition string (as returned by
 * `pg_get_constraintdef`) into a column name and permitted values array.
 *
 * Handles two shapes that Postgres emits for enum-style checks:
 *
 * 1. `= ANY (ARRAY[...])` — Postgres rewrites `col IN ('a','b')` to this form:
 *    `CHECK ((col = ANY (ARRAY['a'::text, 'b'::text])))`
 *
 * 2. `IN (...)` — stays as-is when written directly:
 *    `CHECK ((col IN ('a', 'b')))`
 *
 * Column names may be plain identifiers (`status`) or double-quoted identifiers
 * (`"my-col"`). Double-quoted identifiers with embedded `""` are un-escaped to a
 * single `"`.
 *
 * String literal values may contain Postgres-style doubled single-quotes (`''`),
 * which are un-escaped to a single `'` (e.g. `O''Brien` → `O'Brien`).
 *
 * Returns `{ column, permittedValues }` when the predicate matches one of
 * the two recognised shapes. Returns `undefined` for anything else (e.g.
 * a free-form SQL predicate that wasn't emitted by this slice).
 */
export function parseCheckConstraintDef(
  constraintdef: string,
): { column: string; permittedValues: readonly string[] } | undefined {
  // Strip outer `CHECK (...)` wrapper and any extra parentheses.
  // pg_get_constraintdef returns e.g. `CHECK ((col = ANY (ARRAY[...])))` — note
  // the double parens: one from CHECK and one that Postgres wraps the predicate
  // in. Strip both outer layers.
  const afterCheck = constraintdef
    .replace(/^CHECK\s*\(/i, '')
    .replace(/\)$/, '')
    .trim();
  // Strip one more optional paren pair (the inner wrap Postgres adds)
  const inner =
    afterCheck.startsWith('(') && afterCheck.endsWith(')')
      ? afterCheck.slice(1, -1).trim()
      : afterCheck;

  // Shape 1: col = ANY (ARRAY['a'::text, 'b'::text])
  // Accepts both plain identifiers and double-quoted identifiers for the column.
  // Anchored at the end so a composite predicate (e.g. `col = ANY (...) AND x > 0`)
  // does not partial-match.
  const anyArrayMatch = inner.match(
    /^(?:"((?:[^"]|"")*)"|(\w+))\s*=\s*ANY\s*\(\s*ARRAY\s*\[(.+)\]\s*\)\s*$/i,
  );
  if (anyArrayMatch) {
    const column =
      anyArrayMatch[1] !== undefined ? anyArrayMatch[1].replace(/""/g, '"') : anyArrayMatch[2];
    const arrayBody = anyArrayMatch[3];
    if (!column || !arrayBody) return undefined;
    const permittedValues = extractArrayLiterals(arrayBody);
    return permittedValues ? { column, permittedValues } : undefined;
  }

  // Shape 2: col IN ('a', 'b')
  // Accepts both plain identifiers and double-quoted identifiers for the column.
  // Anchored at the end so a composite predicate (e.g. `col IN (...) AND x > 0`)
  // does not partial-match.
  const inMatch = inner.match(/^(?:"((?:[^"]|"")*)"|(\w+))\s+IN\s*\((.+)\)\s*$/i);
  if (inMatch) {
    const column = inMatch[1] !== undefined ? inMatch[1].replace(/""/g, '"') : inMatch[2];
    const listBody = inMatch[3];
    if (!column || !listBody) return undefined;
    const permittedValues = extractQuotedLiterals(listBody);
    return permittedValues ? { column, permittedValues } : undefined;
  }

  return undefined;
}

/**
 * Extracts string literals from an `ARRAY[...]` body.
 * Handles `'value'::type` casts by stripping the cast part.
 * Postgres stores single quotes inside values as doubled single-quotes (`''`);
 * each extracted value is un-escaped so `O''Brien` becomes `O'Brien`.
 */
function extractArrayLiterals(arrayBody: string): readonly string[] | undefined {
  // Match 'value'::cast or 'value' (with possible spaces)
  const pattern = /'((?:[^'\\]|\\.|'')*)'\s*(?:::[^\s,\]]+)?/g;
  const values = [...arrayBody.matchAll(pattern)].map((m) => (m[1] ?? '').replace(/''/g, "'"));
  return values.length > 0 ? values : undefined;
}

/**
 * Extracts string literals from an `IN (...)` list.
 * Handles single-quoted literals with possible escaped quotes.
 * Postgres stores single quotes inside values as doubled single-quotes (`''`);
 * each extracted value is un-escaped so `O''Brien` becomes `O'Brien`.
 */
function extractQuotedLiterals(listBody: string): readonly string[] | undefined {
  const pattern = /'((?:[^'\\]|\\.|'')*)'/g;
  const values = [...listBody.matchAll(pattern)].map((m) => (m[1] ?? '').replace(/''/g, "'"));
  return values.length > 0 ? values : undefined;
}

// ---------------------------------------------------------------------------
// pgRenderDdlExecuteRequest — independent DDL walker for lowerToExecuteRequest
// ---------------------------------------------------------------------------

function pgIsTextLikeNativeType(nativeType: string): boolean {
  return (
    nativeType === 'text' ||
    nativeType === 'varchar' ||
    nativeType.startsWith('varchar(') ||
    nativeType === 'character varying' ||
    nativeType.startsWith('character varying(') ||
    nativeType === 'char' ||
    nativeType.startsWith('char(') ||
    nativeType === 'character' ||
    nativeType.startsWith('character(')
  );
}

function pgInlineLiteral(wire: unknown, nativeType: string): string {
  if (wire === null) return 'NULL';
  if (typeof wire === 'boolean') return wire ? 'true' : 'false';
  if (typeof wire === 'number') {
    if (!Number.isFinite(wire)) {
      throw new Error(
        `pgRenderDdlExecuteRequest: non-finite number wire value ${String(wire)} cannot be emitted as a DEFAULT literal for native type "${nativeType}"`,
      );
    }
    return String(wire);
  }
  if (typeof wire === 'bigint') return String(wire);
  if (wire instanceof Date) {
    if (Number.isNaN(wire.getTime())) {
      throw new Error(
        `pgRenderDdlExecuteRequest: invalid Date value cannot be emitted as a DEFAULT literal for native type "${nativeType}"`,
      );
    }
    const quoted = `'${escapeLiteral(wire.toISOString())}'`;
    return pgIsTextLikeNativeType(nativeType) ? quoted : `${quoted}::${nativeType}`;
  }
  if (typeof wire === 'string') {
    const quoted = `'${escapeLiteral(wire)}'`;
    return pgIsTextLikeNativeType(nativeType) ? quoted : `${quoted}::${nativeType}`;
  }
  if (wire instanceof Uint8Array) {
    const hex = Array.from(wire)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `'\\x${hex}'::${nativeType}`;
  }
  if (typeof wire === 'object') {
    const quoted = `'${escapeLiteral(JSON.stringify(wire))}'`;
    return `${quoted}::${nativeType}`;
  }
  throw new Error(
    `pgRenderDdlExecuteRequest: unexpected wire type "${typeof wire}" for native type "${nativeType}"`,
  );
}

async function pgRenderDdlColumnDefault(
  def: LiteralColumnDefault | FunctionColumnDefault,
  nativeType: string,
  codecLookup: CodecLookup,
  codecRef: CodecRef | undefined,
): Promise<string> {
  if (def.kind === 'function') {
    if (def.expression === 'autoincrement()') return '';
    return `DEFAULT (${def.expression})`;
  }
  if (codecRef !== undefined) {
    const codec = codecLookup.get(codecRef.codecId);
    if (codec !== undefined) {
      const wire = await codec.encode(def.value, {});
      return `DEFAULT ${pgInlineLiteral(wire, nativeType)}`;
    }
  }
  // Fallback: codec-less literal defaults follow RawSqlLiteral wire-scalar semantics.
  return `DEFAULT ${pgInlineLiteral(def.value, nativeType)}`;
}

async function pgRenderDdlColumn(column: DdlColumn, codecLookup: CodecLookup): Promise<string> {
  const parts = [quoteIdentifier(column.name), column.type];
  if (column.default) {
    const clause = await pgRenderDdlColumnDefault(
      column.default,
      column.type,
      codecLookup,
      column.codecRef,
    );
    if (clause.length > 0) parts.push(clause);
  }
  if (column.notNull) parts.push('NOT NULL');
  if (column.primaryKey) parts.push('PRIMARY KEY');
  return parts.join(' ');
}

function pgRenderDdlConstraint(constraint: DdlTableConstraint): string {
  if (constraint.kind === 'primary-key') {
    const cols = constraint.columns.map(quoteIdentifier).join(', ');
    if (constraint.name !== undefined) {
      return `CONSTRAINT ${quoteIdentifier(constraint.name)} PRIMARY KEY (${cols})`;
    }
    return `PRIMARY KEY (${cols})`;
  }
  if (constraint.kind === 'foreign-key') {
    const cols = constraint.columns.map(quoteIdentifier).join(', ');
    const refTable = constraint.refTable.split('.').map(quoteIdentifier).join('.');
    const refCols = constraint.refColumns.map(quoteIdentifier).join(', ');
    let sql = `FOREIGN KEY (${cols}) REFERENCES ${refTable} (${refCols})`;
    if (constraint.onDelete !== undefined) {
      sql += ` ON DELETE ${REFERENTIAL_ACTION_SQL[constraint.onDelete]}`;
    }
    if (constraint.onUpdate !== undefined) {
      sql += ` ON UPDATE ${REFERENTIAL_ACTION_SQL[constraint.onUpdate]}`;
    }
    if (constraint.name !== undefined) {
      sql = `CONSTRAINT ${quoteIdentifier(constraint.name)} ${sql}`;
    }
    return sql;
  }
  const cols = constraint.columns.map(quoteIdentifier).join(', ');
  if (constraint.name !== undefined) {
    return `CONSTRAINT ${quoteIdentifier(constraint.name)} UNIQUE (${cols})`;
  }
  return `UNIQUE (${cols})`;
}

async function pgRenderCreateTable(
  node: PostgresCreateTable,
  codecLookup: CodecLookup,
): Promise<SqlExecuteRequest> {
  const ifNotExists = node.ifNotExists ? 'IF NOT EXISTS ' : '';
  const tableRef = node.schema
    ? `${quoteIdentifier(node.schema)}.${quoteIdentifier(node.table)}`
    : quoteIdentifier(node.table);
  const columnDefs = await Promise.all(
    node.columns.map((col) => pgRenderDdlColumn(col, codecLookup)),
  );
  const constraintDefs =
    node.constraints !== undefined ? node.constraints.map(pgRenderDdlConstraint) : [];
  const allDefs = [...columnDefs, ...constraintDefs].join(',\n  ');
  return {
    sql: `CREATE TABLE ${ifNotExists}${tableRef} (\n  ${allDefs}\n)`,
    params: [],
  };
}

function pgRenderCreateSchema(node: PostgresCreateSchema): SqlExecuteRequest {
  const ifNotExists = node.ifNotExists ? 'IF NOT EXISTS ' : '';
  return {
    sql: `CREATE SCHEMA ${ifNotExists}${quoteIdentifier(node.schema)}`,
    params: [],
  };
}

async function pgRenderAlterTable(
  node: PostgresAlterTable,
  codecLookup: CodecLookup,
): Promise<SqlExecuteRequest> {
  const tableRef = node.schema
    ? `${quoteIdentifier(node.schema)}.${quoteIdentifier(node.table)}`
    : quoteIdentifier(node.table);
  const actionVisitor: AlterTableActionVisitor<Promise<string>> = {
    async addColumn(action: AddColumnAction): Promise<string> {
      const colFragment = await pgRenderDdlColumn(action.column, codecLookup);
      return `ADD COLUMN ${colFragment}`;
    },
    dropDefault(action: DropDefaultAction): Promise<string> {
      return Promise.resolve(`ALTER COLUMN ${quoteIdentifier(action.columnName)} DROP DEFAULT`);
    },
  };
  const actionSqls = await Promise.all(node.actions.map((a) => a.accept(actionVisitor)));
  return {
    sql: `ALTER TABLE ${tableRef} ${actionSqls.join(', ')}`,
    params: [],
  };
}

async function pgRenderDdlExecuteRequest(
  ast: PostgresDdlNode,
  codecLookup: CodecLookup,
): Promise<SqlExecuteRequest> {
  const visitor = {
    createTable: (node: PostgresCreateTable) => pgRenderCreateTable(node, codecLookup),
    createSchema: (node: PostgresCreateSchema) => Promise.resolve(pgRenderCreateSchema(node)),
    alterTable: (node: PostgresAlterTable) => pgRenderAlterTable(node, codecLookup),
  };
  return ast.accept(visitor);
}
