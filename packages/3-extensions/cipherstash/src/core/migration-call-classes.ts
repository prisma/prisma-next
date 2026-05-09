/**
 * Cipherstash migration IR — renderable `*Call` classes for the codec
 * lifecycle hook + the public `@prisma-next/extension-cipherstash/migration`
 * factory functions.
 *
 * Each `*Call` implements the framework `OpFactoryCall` interface (ADR
 * 195) directly, so cipherstash's contributions flow through the postgres
 * planner as first-class IR nodes — no `RawSqlCall` wrap, no detour
 * through the unstructured-op fallback. The codec hook
 * (`./cipherstash-codec.ts`) returns Calls; the postgres planner adds
 * them to its call list and renders them via `renderCallsToTypeScript`.
 *
 * Public factory functions (`cipherstashAddSearchConfig` /
 * `cipherstashRemoveSearchConfig`) are re-exported from
 * `@prisma-next/extension-cipherstash/migration`. Users authoring a
 * hand-written migration can call them directly:
 *
 * ```ts
 * import { cipherstashAddSearchConfig } from '@prisma-next/extension-cipherstash/migration';
 *
 * createTable('public', 'user', [...]);
 * cipherstashAddSearchConfig({ table: 'user', column: 'email', index: 'unique' });
 * ```
 *
 * Round-trip invariant: `toOp()` produces the same shape the codec hook
 * used to build via `buildAddOp` / `buildRemoveOp` (pre-CR-1). `ops.json`
 * stays byte-identical across the refactor; only `migration.ts` changes
 * (factory call instead of `rawSql({...})`).
 */

import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type {
  MigrationOperationClass,
  OpFactoryCall,
} from '@prisma-next/framework-components/control';
import { type ImportRequirement, jsonToTsSource, TsExpression } from '@prisma-next/ts-render';

const CIPHERSTASH_MIGRATION_MODULE = '@prisma-next/extension-cipherstash/migration';

/** Mirrors `eql_v2.add_search_config(table, column, index_name, cast_as)`. */
const DEFAULT_CAST_AS = 'text';

/**
 * Two-valued enumeration matching the EQL search-config indices the
 * cipherstash codec emits — one per enabled flag in
 * `Encrypted<string>`'s `typeParams`:
 *
 *   - `equality: true`        → `'unique'` index
 *   - `freeTextSearch: true`  → `'match'`  index
 */
export type CipherstashSearchIndex = 'unique' | 'match';

/**
 * Args shape accepted by the public `cipherstashAddSearchConfig` /
 * `cipherstashRemoveSearchConfig` factory functions.
 *
 * `castAs` defaults to `'text'` — matches the cipherstash codec hook's
 * canonical output and the EQL bundle's expected cast for
 * `eql_v2_encrypted` columns. Override only if you know the runtime
 * cast for your column differs.
 */
export interface CipherstashSearchConfigArgs {
  readonly table: string;
  readonly column: string;
  readonly index: CipherstashSearchIndex;
  readonly castAs?: string;
}

type CipherstashOp = SqlMigrationPlanOperation<unknown>;

/**
 * Escape a string so it can be embedded inside a Postgres single-quoted
 * literal. Identifiers in our IR are unlikely to contain apostrophes,
 * but doubling them keeps the emitted SQL safe under any future
 * relaxation.
 */
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function invariantIdFor(
  tableName: string,
  fieldName: string,
  action: 'add-search-config' | 'remove-search-config',
  indexName: CipherstashSearchIndex,
): string {
  return `cipherstash-codec:${tableName}.${fieldName}:${action}:${indexName}@v1`;
}

abstract class CipherstashOpFactoryCallNode extends TsExpression implements OpFactoryCall {
  abstract readonly factoryName: string;
  abstract readonly operationClass: MigrationOperationClass;
  abstract readonly label: string;
  abstract toOp(): CipherstashOp;

  importRequirements(): readonly ImportRequirement[] {
    return [{ moduleSpecifier: CIPHERSTASH_MIGRATION_MODULE, symbol: this.factoryName }];
  }

  protected freeze(): void {
    Object.freeze(this);
  }
}

/**
 * `cipherstashAddSearchConfig` — register an EQL search-config row for
 * the given column / index combination. Lowers to a `SELECT
 * eql_v2.add_search_config('<table>', '<column>', '<index>',
 * '<castAs>')` op, classified `'additive'`.
 */
export class CipherstashAddSearchConfigCall extends CipherstashOpFactoryCallNode {
  readonly factoryName = 'cipherstashAddSearchConfig' as const;
  readonly operationClass = 'additive' as const;
  readonly table: string;
  readonly column: string;
  readonly index: CipherstashSearchIndex;
  readonly castAs: string;
  readonly label: string;

  constructor(
    table: string,
    column: string,
    index: CipherstashSearchIndex,
    castAs: string = DEFAULT_CAST_AS,
  ) {
    super();
    this.table = table;
    this.column = column;
    this.index = index;
    this.castAs = castAs;
    this.label = `Register cipherstash search config (${index}) for ${table}.${column}`;
    this.freeze();
  }

  toOp(): CipherstashOp {
    return {
      id: `cipherstash-codec.${this.table}.${this.column}.add-search-config.${this.index}`,
      label: this.label,
      operationClass: 'additive',
      invariantId: invariantIdFor(this.table, this.column, 'add-search-config', this.index),
      target: { id: 'postgres' },
      precheck: [],
      execute: [
        {
          description: `Register cipherstash ${this.index} search config for ${this.table}.${this.column}`,
          sql: `SELECT eql_v2.add_search_config(${sqlLiteral(this.table)}, ${sqlLiteral(this.column)}, ${sqlLiteral(this.index)}, ${sqlLiteral(this.castAs)});`,
        },
      ],
      postcheck: [],
    };
  }

  renderTypeScript(): string {
    const args = {
      table: this.table,
      column: this.column,
      index: this.index,
      ...(this.castAs !== DEFAULT_CAST_AS ? { castAs: this.castAs } : {}),
    };
    return `cipherstashAddSearchConfig(${jsonToTsSource(args)})`;
  }
}

/**
 * `cipherstashRemoveSearchConfig` — invert
 * {@link CipherstashAddSearchConfigCall} for the same (table, column,
 * index) tuple. Lowers to `SELECT eql_v2.remove_search_config('<table>',
 * '<column>', '<index>')`, classified `'destructive'`.
 *
 * No `castAs` argument — `eql_v2.remove_search_config` takes only the
 * three identifying fields; the cast was applied at the index's add
 * site.
 */
export class CipherstashRemoveSearchConfigCall extends CipherstashOpFactoryCallNode {
  readonly factoryName = 'cipherstashRemoveSearchConfig' as const;
  readonly operationClass = 'destructive' as const;
  readonly table: string;
  readonly column: string;
  readonly index: CipherstashSearchIndex;
  readonly label: string;

  constructor(table: string, column: string, index: CipherstashSearchIndex) {
    super();
    this.table = table;
    this.column = column;
    this.index = index;
    this.label = `Remove cipherstash search config (${index}) for ${table}.${column}`;
    this.freeze();
  }

  toOp(): CipherstashOp {
    return {
      id: `cipherstash-codec.${this.table}.${this.column}.remove-search-config.${this.index}`,
      label: this.label,
      operationClass: 'destructive',
      invariantId: invariantIdFor(this.table, this.column, 'remove-search-config', this.index),
      target: { id: 'postgres' },
      precheck: [],
      execute: [
        {
          description: `Remove cipherstash ${this.index} search config for ${this.table}.${this.column}`,
          sql: `SELECT eql_v2.remove_search_config(${sqlLiteral(this.table)}, ${sqlLiteral(this.column)}, ${sqlLiteral(this.index)});`,
        },
      ],
      postcheck: [],
    };
  }

  renderTypeScript(): string {
    return `cipherstashRemoveSearchConfig(${jsonToTsSource({
      table: this.table,
      column: this.column,
      index: this.index,
    })})`;
  }
}

/**
 * Public factory: register a cipherstash search-config row.
 *
 * Use from a hand-written migration when you need to wire EQL
 * search-config alongside a `createTable` / `addColumn`. The
 * `Encrypted<string>` codec hook calls this factory automatically when
 * planning a contract diff that adds a `searchable: true` column.
 */
export function cipherstashAddSearchConfig(
  args: CipherstashSearchConfigArgs,
): CipherstashAddSearchConfigCall {
  return new CipherstashAddSearchConfigCall(
    args.table,
    args.column,
    args.index,
    args.castAs ?? DEFAULT_CAST_AS,
  );
}

/**
 * Public factory: invert {@link cipherstashAddSearchConfig} for the
 * same (table, column, index) tuple.
 */
export function cipherstashRemoveSearchConfig(
  args: CipherstashSearchConfigArgs,
): CipherstashRemoveSearchConfigCall {
  return new CipherstashRemoveSearchConfigCall(args.table, args.column, args.index);
}
