import type { ContractMarkerRecord, LedgerEntryRecord } from '@prisma-next/contract/types';
import { parseMarkerRowSafely, withMarkerReadErrorHandling } from '@prisma-next/errors/execution';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { parseContractMarkerRow } from '@prisma-next/family-sql/verify';
import {
  APP_SPACE_ID,
  type ControlDriverInstance,
} from '@prisma-next/framework-components/control';
import { ledgerOriginFromStored } from '@prisma-next/migration-tools/ledger-origin';
import type {
  AnyQueryAst,
  DdlNode,
  LoweredStatement,
  LowererContext,
  MarkerReadResult,
} from '@prisma-next/sql-relational-core/ast';
import { isDdlNode } from '@prisma-next/sql-relational-core/ast';
import type {
  PrimaryKey,
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
} from '@prisma-next/target-sqlite/contract-free';
import type { SqliteDdlNode } from '@prisma-next/target-sqlite/ddl';
import { parseSqliteDefault } from '@prisma-next/target-sqlite/default-normalizer';
import { normalizeSqliteNativeType } from '@prisma-next/target-sqlite/native-type-normalizer';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import { renderLoweredSql } from './adapter';
import { renderLoweredDdl } from './ddl-renderer';
import { coerceLedgerAppliedAt, operationCountFromStored } from './ledger-decode';
import {
  decodeSqliteMarkerRow,
  execute,
  ledger,
  ledgerReadShape,
  marker,
  mergeInvariants,
  NOW,
  sqliteCatalog,
} from './marker-ledger';
import type { SqliteContract } from './types';

const SQLITE_MARKER_TABLE = '_prisma_marker';
const SQLITE_LEDGER_TABLE = '_prisma_ledger';

type SqliteLedgerRow = {
  readonly space: string;
  readonly migration_name: string;
  readonly migration_hash: string;
  readonly origin_core_hash: string | null;
  readonly destination_core_hash: string;
  readonly operations: unknown;
  readonly created_at: Date | string;
};

// PRAGMA result row types
type PragmaTableInfoRow = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

type PragmaForeignKeyRow = {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
};

type PragmaIndexListRow = {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
};

type PragmaIndexInfoRow = {
  seqno: number;
  cid: number;
  name: string;
};

type FkAccumulator = {
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete: string;
  onUpdate: string;
};

export class SqliteControlAdapter implements SqlControlAdapter<'sqlite'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'sqlite' as const;

  readonly normalizeDefault = parseSqliteDefault;
  readonly normalizeNativeType = normalizeSqliteNativeType;

  bootstrapControlTableQueries(): readonly DdlNode[] {
    return buildControlTableBootstrapQueries();
  }

  bootstrapSignMarkerQueries(): readonly DdlNode[] {
    return buildSignMarkerBootstrapQueries();
  }

  /**
   * Lower a SQL query AST into a SQLite-flavored `{ sql, params }` payload.
   *
   * Delegates to the shared `renderLoweredSql` renderer so the control adapter
   * emits byte-identical SQL to `SqliteAdapterImpl.lower()` for the same AST
   * and contract. Used at migration plan/emit time (e.g. by `dataTransform`)
   * without instantiating the runtime adapter.
   */
  lower(ast: AnyQueryAst | SqliteDdlNode, context: LowererContext<unknown>): LoweredStatement {
    if (isDdlNode(ast)) {
      return renderLoweredDdl(ast);
    }
    return renderLoweredSql(ast, context.contract as SqliteContract);
  }

  /**
   * Reads the contract marker from `_prisma_marker`. Probes `sqlite_master`
   * first so a fresh database (no marker table) returns `null` instead of a
   * "no such table" error.
   */
  async readMarker(
    driver: ControlDriverInstance<'sql', 'sqlite'>,
    space: string,
  ): Promise<ContractMarkerRecord | null> {
    const result = await this.readMarkerDiscriminated(driver, space);
    return result.kind === 'present' ? result.record : null;
  }

  async readMarkerDiscriminated(
    driver: ControlDriverInstance<'sql', 'sqlite'>,
    space: string,
  ): Promise<MarkerReadResult> {
    const markerContext = { space, markerLocation: SQLITE_MARKER_TABLE };
    return withMarkerReadErrorHandling(() => this.readMarkerResult(driver, space), markerContext);
  }

  /**
   * Reads every row from `_prisma_marker` and returns them keyed by
   * `space`. Mirrors the existence probe in {@link readMarker}: a
   * fresh database without the marker table returns an empty map.
   */
  async readAllMarkers(
    driver: ControlDriverInstance<'sql', 'sqlite'>,
  ): Promise<ReadonlyMap<string, ContractMarkerRecord>> {
    const markerContext = { space: APP_SPACE_ID, markerLocation: SQLITE_MARKER_TABLE };
    return withMarkerReadErrorHandling(() => this.readAllMarkersResult(driver), markerContext);
  }

  private async readAllMarkersResult(
    driver: ControlDriverInstance<'sql', 'sqlite'>,
  ): Promise<ReadonlyMap<string, ContractMarkerRecord>> {
    const lower = (query: AnyQueryAst) => this.lower(query, { contract: undefined });
    const probe = sqliteCatalog
      .select(sqliteCatalog.name)
      .where(sqliteCatalog.type.eq('table').and(sqliteCatalog.name.eq('_prisma_marker')))
      .build();
    const exists = await execute(lower, driver, probe);
    if (exists.length === 0) {
      return new Map();
    }

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
        parseMarkerRowSafely(row, (raw) => parseContractMarkerRow(decodeSqliteMarkerRow(raw)), {
          space: row.space,
          markerLocation: SQLITE_MARKER_TABLE,
        }),
      );
    }
    return out;
  }

  /**
   * Reads per-migration ledger rows from `_prisma_ledger` in apply order.
   * Probes `sqlite_master` first so a fresh database without the ledger
   * table returns `[]` instead of raising "no such table".
   */
  async readLedger(
    driver: ControlDriverInstance<'sql', 'sqlite'>,
    space?: string,
  ): Promise<readonly LedgerEntryRecord[]> {
    const ledgerContext = { space: space ?? '*', markerLocation: SQLITE_LEDGER_TABLE };
    return withMarkerReadErrorHandling(() => this.readLedgerResult(driver, space), ledgerContext);
  }

  private async readLedgerResult(
    driver: ControlDriverInstance<'sql', 'sqlite'>,
    space: string | undefined,
  ): Promise<readonly LedgerEntryRecord[]> {
    const lower = (query: AnyQueryAst) => this.lower(query, { contract: undefined });
    const probe = sqliteCatalog
      .select(sqliteCatalog.name)
      .where(sqliteCatalog.type.eq('table').and(sqliteCatalog.name.eq('_prisma_ledger')))
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
    const rows = blindCast<readonly SqliteLedgerRow[], 'Driver returns rows shaped by SELECT'>(
      rawRows,
    );

    return rows.map((row) => ({
      space: row.space,
      migrationName: row.migration_name,
      migrationHash: row.migration_hash,
      from: ledgerOriginFromStored(row.origin_core_hash),
      to: row.destination_core_hash,
      appliedAt: coerceLedgerAppliedAt(row.created_at),
      operationCount: operationCountFromStored(row.operations),
    }));
  }

  /**
   * Stamps the initial marker row for `space` via the shared contract-free DML
   * builder, lowered through {@link lower} and executed on the driver. See the
   * `SqlControlAdapter.initMarker` contract.
   */
  async insertMarker(
    driver: ControlDriverInstance<'sql', 'sqlite'>,
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
    driver: ControlDriverInstance<'sql', 'sqlite'>,
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
    driver: ControlDriverInstance<'sql', 'sqlite'>,
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
    driver: ControlDriverInstance<'sql', 'sqlite'>,
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

  private async readMarkerResult(driver: ControlDriverInstance<'sql', 'sqlite'>, space: string) {
    const lower = (query: AnyQueryAst) => this.lower(query, { contract: undefined });
    const probe = sqliteCatalog
      .select(sqliteCatalog.name)
      .where(sqliteCatalog.type.eq('table').and(sqliteCatalog.name.eq('_prisma_marker')))
      .build();
    const exists = await execute(lower, driver, probe);
    if (exists.length === 0) return { kind: 'no-table' as const };

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
    return {
      kind: 'present' as const,
      record: parseContractMarkerRow(decodeSqliteMarkerRow(row)),
    };
  }

  async introspect(
    driver: ControlDriverInstance<'sql', 'sqlite'>,
    _contract?: unknown,
  ): Promise<SqlSchemaIR> {
    // Filter out runner-managed control tables (`_prisma_marker`,
    // `_prisma_ledger`) — they're an implementation detail of the migration
    // runner, not part of the user-authored contract, so they must not
    // appear in introspection output (otherwise strict schema verification
    // flags them as `extra_table`).
    const tablesResult = await driver.query<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT IN ('_prisma_marker', '_prisma_ledger')
       ORDER BY name`,
    );

    const tables: Record<string, SqlTableIR> = {};

    for (const tableRow of tablesResult.rows) {
      const tableName = tableRow.name;

      // SQLite's synchronous driver serializes reads — no benefit from Promise.all
      const columnsResult = await driver.query<PragmaTableInfoRow>(
        `PRAGMA table_info("${escapePragmaArg(tableName)}")`,
      );
      const fkResult = await driver.query<PragmaForeignKeyRow>(
        `PRAGMA foreign_key_list("${escapePragmaArg(tableName)}")`,
      );
      const indexListResult = await driver.query<PragmaIndexListRow>(
        `PRAGMA index_list("${escapePragmaArg(tableName)}")`,
      );

      const columns: Record<string, SqlColumnIR> = {};
      const pkColumns: Array<{ name: string; pk: number }> = [];

      for (const col of columnsResult.rows) {
        columns[col.name] = {
          name: col.name,
          nativeType: col.type.toLowerCase(),
          nullable: col.notnull === 0 && col.pk === 0,
          ...ifDefined('default', col.dflt_value ?? undefined),
        };
        if (col.pk > 0) {
          pkColumns.push({ name: col.name, pk: col.pk });
        }
      }

      pkColumns.sort((a, b) => a.pk - b.pk);
      const primaryKey: PrimaryKey | undefined =
        pkColumns.length > 0 ? { columns: pkColumns.map((c) => c.name) } : undefined;

      const fkMap = new Map<number, FkAccumulator>();
      for (const fk of fkResult.rows) {
        const existing = fkMap.get(fk.id);
        if (existing) {
          existing.columns.push(fk.from);
          existing.referencedColumns.push(fk.to);
        } else {
          fkMap.set(fk.id, {
            columns: [fk.from],
            referencedTable: fk.table,
            referencedColumns: [fk.to],
            onDelete: fk.on_delete,
            onUpdate: fk.on_update,
          });
        }
      }
      const foreignKeys: readonly SqlForeignKeyIR[] = Array.from(fkMap.values()).map((fk) => ({
        columns: Object.freeze([...fk.columns]) as readonly string[],
        referencedTable: fk.referencedTable,
        referencedColumns: Object.freeze([...fk.referencedColumns]) as readonly string[],
        ...ifDefined('onDelete', mapSqliteReferentialAction(fk.onDelete)),
        ...ifDefined('onUpdate', mapSqliteReferentialAction(fk.onUpdate)),
      }));

      const uniques: SqlUniqueIR[] = [];
      const indexes: SqlIndexIR[] = [];

      for (const idx of indexListResult.rows) {
        // origin: 'c' = CREATE INDEX, 'u' = UNIQUE constraint, 'pk' = PRIMARY KEY
        const idxInfoResult = await driver.query<PragmaIndexInfoRow>(
          `PRAGMA index_info("${escapePragmaArg(idx.name)}")`,
        );

        const idxColumns = idxInfoResult.rows.sort((a, b) => a.seqno - b.seqno).map((r) => r.name);

        if (idx.origin === 'u') {
          uniques.push({
            columns: Object.freeze([...idxColumns]) as readonly string[],
            name: idx.name,
          });
        } else if (idx.origin === 'c') {
          indexes.push({
            columns: Object.freeze([...idxColumns]) as readonly string[],
            name: idx.name,
            unique: idx.unique === 1,
          });
        }
        // Skip 'pk' origin — already captured in primaryKey
      }

      tables[tableName] = {
        name: tableName,
        columns,
        ...ifDefined('primaryKey', primaryKey),
        foreignKeys,
        uniques,
        indexes,
      };
    }

    return {
      tables,
    };
  }
}

// PRAGMA queries use the function-argument form (`PRAGMA table_info("name")`)
// which doesn't support `?` placeholders — the argument is part of the
// statement name, not a bound parameter. We quote-escape the table name instead.
function escapePragmaArg(name: string): string {
  return name.replace(/"/g, '""');
}

const SQLITE_REFERENTIAL_ACTION_MAP: Record<string, SqlReferentialAction> = {
  'NO ACTION': 'noAction',
  RESTRICT: 'restrict',
  CASCADE: 'cascade',
  'SET NULL': 'setNull',
  'SET DEFAULT': 'setDefault',
};

function mapSqliteReferentialAction(rule: string): SqlReferentialAction | undefined {
  const normalized = rule.toUpperCase();
  const mapped = SQLITE_REFERENTIAL_ACTION_MAP[normalized];
  if (mapped === undefined) {
    throw new Error(
      `Unknown SQLite referential action rule: "${rule}". ` +
        'Expected one of: NO ACTION, RESTRICT, CASCADE, SET NULL, SET DEFAULT.',
    );
  }
  if (mapped === 'noAction') return undefined;
  return mapped;
}
