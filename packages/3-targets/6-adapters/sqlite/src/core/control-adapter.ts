import type { ControlDriverInstance } from '@prisma-next/core-control-plane/types';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import type {
  PrimaryKey,
  SqlColumnIR,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlSchemaIR,
  SqlTableIR,
  SqlUniqueIR,
} from '@prisma-next/sql-schema-ir/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { parseSqliteDefault } from './default-normalizer';

type SqliteTableRow = { name: string };

type PragmaTableInfoRow = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
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

type PragmaForeignKeyRow = {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
};

/**
 * SQLite control plane adapter for control-plane operations like introspection.
 */
export class SqliteControlAdapter implements SqlControlAdapter<'sqlite'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'sqlite' as const;
  /**
   * @deprecated Use targetId instead
   */
  readonly target = 'sqlite' as const;

  readonly normalizeDefault = parseSqliteDefault;

  async introspect(
    driver: ControlDriverInstance<'sql', 'sqlite'>,
    _contractIR?: unknown,
    _schema?: string,
  ): Promise<SqlSchemaIR> {
    const tablesResult = await driver.query<SqliteTableRow>(
      `select name
       from sqlite_master
       where type = 'table'
         and name not like 'sqlite_%'
         and name not like 'prisma_contract_%'
       order by name`,
    );

    const tables: Record<string, SqlTableIR> = {};

    for (const tableRow of tablesResult.rows) {
      const tableName = tableRow.name;

      const columnsResult = await driver.query<PragmaTableInfoRow>(
        `pragma table_info(${escapeSqliteStringLiteral(tableName)})`,
      );

      const columns: Record<string, SqlColumnIR> = {};

      // Primary key columns: pk is 1..N for composite keys.
      const pkColumns = columnsResult.rows
        .filter((r) => r.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((r) => r.name);

      const primaryKey: PrimaryKey | undefined =
        pkColumns.length > 0 ? { columns: pkColumns } : undefined;

      for (const colRow of columnsResult.rows) {
        // Normalize to lower-case for consistent comparisons with contract nativeType,
        // which is always emitted in lower-case (e.g., "text", "integer").
        const nativeType =
          colRow.type && colRow.type.length > 0 ? colRow.type.trim().toLowerCase() : 'text';

        // SQLite reports `notnull = 0` for PRIMARY KEY columns even though they are not nullable.
        // It also omits any explicit default for INTEGER PRIMARY KEY columns even though they have
        // implicit autoincrement semantics. We encode these semantics into the IR so schema
        // verification can compare against contract defaults/nullability.
        let defaultValue = colRow.dflt_value ?? undefined;
        if (
          defaultValue === undefined &&
          pkColumns.length === 1 &&
          pkColumns[0] === colRow.name &&
          /int/i.test(nativeType)
        ) {
          defaultValue = 'autoincrement()';
        }

        columns[colRow.name] = {
          name: colRow.name,
          nativeType,
          nullable: colRow.notnull === 0 && colRow.pk === 0,
          ...ifDefined('default', defaultValue),
        };
      }

      const foreignKeys = await introspectForeignKeys(driver, tableName);
      const { uniques, indexes } = await introspectIndexes(driver, tableName);

      tables[tableName] = {
        name: tableName,
        columns,
        ...(primaryKey ? { primaryKey } : {}),
        foreignKeys,
        uniques,
        indexes,
      };
    }

    return {
      tables,
      extensions: [],
    };
  }
}

async function introspectForeignKeys(
  driver: ControlDriverInstance<'sql', 'sqlite'>,
  tableName: string,
): Promise<readonly SqlForeignKeyIR[]> {
  const rows = await driver.query<PragmaForeignKeyRow>(
    `pragma foreign_key_list(${escapeSqliteStringLiteral(tableName)})`,
  );

  const byId = new Map<
    number,
    {
      referencedTable: string;
      columns: string[];
      referencedColumns: string[];
    }
  >();

  for (const row of rows.rows) {
    const existing = byId.get(row.id);
    if (existing) {
      existing.columns.push(row.from);
      existing.referencedColumns.push(row.to);
      continue;
    }
    byId.set(row.id, {
      referencedTable: row.table,
      columns: [row.from],
      referencedColumns: [row.to],
    });
  }

  return Array.from(byId.values()).map((fk) => ({
    columns: Object.freeze([...fk.columns]) as readonly string[],
    referencedTable: fk.referencedTable,
    referencedColumns: Object.freeze([...fk.referencedColumns]) as readonly string[],
  }));
}

async function introspectIndexes(
  driver: ControlDriverInstance<'sql', 'sqlite'>,
  tableName: string,
): Promise<{ readonly uniques: readonly SqlUniqueIR[]; readonly indexes: readonly SqlIndexIR[] }> {
  const list = await driver.query<PragmaIndexListRow>(
    `pragma index_list(${escapeSqliteStringLiteral(tableName)})`,
  );

  const uniques: SqlUniqueIR[] = [];
  const indexes: SqlIndexIR[] = [];

  for (const idx of list.rows) {
    // Skip PK indexes (covered by pragma_table_info pk metadata)
    if (idx.origin === 'pk') {
      continue;
    }

    const info = await driver.query<PragmaIndexInfoRow>(
      `pragma index_info(${escapeSqliteStringLiteral(idx.name)})`,
    );

    const columns = info.rows
      .slice()
      .sort((a, b) => a.seqno - b.seqno)
      .map((r) => r.name);

    if (columns.length === 0) {
      continue;
    }

    if (idx.unique === 1) {
      uniques.push({
        columns,
        name: idx.name,
      });
      continue;
    }

    indexes.push({
      columns,
      name: idx.name,
      unique: false,
    });
  }

  return { uniques, indexes };
}

function escapeSqliteStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
