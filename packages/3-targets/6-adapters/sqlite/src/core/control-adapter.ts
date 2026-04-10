import type { ColumnDefault } from '@prisma-next/contract/types';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import type { ControlDriverInstance } from '@prisma-next/framework-components/control';
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
import { ifDefined } from '@prisma-next/utils/defined';
import { sqliteAdapterDescriptorMeta } from './descriptor-meta';

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

  async introspect(
    driver: ControlDriverInstance<'sql', 'sqlite'>,
    _contract?: unknown,
  ): Promise<SqlSchemaIR> {
    const tablesResult = await driver.query<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
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
      dependencies: [],
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

const NULL_PATTERN = /^NULL$/i;
const INTEGER_PATTERN = /^-?\d+$/;
const REAL_PATTERN = /^-?\d+\.\d+(?:[eE][+-]?\d+)?$/;
const HEX_PATTERN = /^-?0[xX][\dA-Fa-f]+$/;
const STRING_LITERAL_PATTERN = /^'((?:[^']|'')*)'$/;

function isNumericLiteral(value: string): boolean {
  return INTEGER_PATTERN.test(value) || REAL_PATTERN.test(value) || HEX_PATTERN.test(value);
}

export function parseSqliteDefault(
  rawDefault: string,
  nativeType?: string,
): ColumnDefault | undefined {
  let trimmed = rawDefault.trim();

  // Strip outer parentheses that SQLite adds around expressions
  while (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  const lower = trimmed.toLowerCase();

  // CURRENT_TIMESTAMP and datetime('now')/datetime("now") are the SQLite forms of now()
  if (lower === 'current_timestamp' || lower === "datetime('now')" || lower === 'datetime("now")') {
    return { kind: 'function', expression: 'now()' };
  }

  if (NULL_PATTERN.test(trimmed)) {
    return { kind: 'literal', value: null };
  }

  // SQLite integer is always 64-bit — can exceed JS safe integer range.
  // Use nativeType to pick strategy: integer → always string, real → always number.
  if (isNumericLiteral(trimmed)) {
    if (nativeType?.toLowerCase() === 'integer') {
      return { kind: 'literal', value: trimmed };
    }
    return { kind: 'literal', value: Number(trimmed) };
  }

  const stringMatch = trimmed.match(STRING_LITERAL_PATTERN);
  if (stringMatch?.[1] !== undefined) {
    const unescaped = stringMatch[1].replace(/''/g, "'");
    return { kind: 'literal', value: unescaped };
  }

  // Unrecognized expression — preserve as function
  return { kind: 'function', expression: trimmed };
}

export function normalizeSqliteNativeType(nativeType: string): string {
  return nativeType.trim().toLowerCase();
}

const sqliteControlAdapterDescriptor = {
  ...sqliteAdapterDescriptorMeta,
  create(_stack): SqlControlAdapter<'sqlite'> {
    return new SqliteControlAdapter();
  },
};

export default sqliteControlAdapterDescriptor;
