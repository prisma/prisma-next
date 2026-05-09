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
type OpStep = CipherstashOp['execute'][number];

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

/**
 * Base class for cipherstash migration IR nodes.
 *
 * Each instance is *both* an `OpFactoryCall` (renderable to TypeScript,
 * lowerable to a runtime op via `toOp()`) and a structurally-valid
 * {@link CipherstashOp} — `id`, `label`, `operationClass`,
 * `invariantId`, `target`, `precheck`, `execute`, `postcheck` are
 * stored as enumerable own properties, populated in the concrete
 * subclass constructors. So when the planner-rendered `migration.ts`
 * runs and the user's `operations` getter returns Call instances
 * directly, both `MigrationOpSchema` validation (which checks `id` /
 * `label` / `operationClass`) and `JSON.stringify` (which writes
 * `ops.json`) see the runtime op shape unchanged.
 *
 * The cipherstash-specific identity fields (`factoryName`, `table`,
 * `column`, `index`, `castAs`) live on the subclass prototype as
 * accessor getters and on a per-instance backing record kept in a
 * private slot (`#args`). Accessor properties on the class are
 * non-enumerable, and the backing record is a private field, so
 * `Object.keys(call)` and `canonicalizeJson(...)` see only the op
 * fields — `ops.json` and `migrationHash` stay byte-stable across the
 * pre/post CR-1 representation switch.
 */
abstract class CipherstashOpFactoryCallNode extends TsExpression implements OpFactoryCall {
  abstract get factoryName(): string;
  abstract readonly operationClass: MigrationOperationClass;
  abstract readonly label: string;
  abstract readonly id: string;
  abstract readonly invariantId: string;
  abstract readonly target: { readonly id: string };
  abstract readonly precheck: readonly OpStep[];
  abstract readonly execute: readonly OpStep[];
  abstract readonly postcheck: readonly OpStep[];

  importRequirements(): readonly ImportRequirement[] {
    return [{ moduleSpecifier: CIPHERSTASH_MIGRATION_MODULE, symbol: this.factoryName }];
  }

  /**
   * Re-expose the runtime op view for callers that prefer to lower
   * Calls explicitly (notably {@link renderOps} on the postgres lane).
   * The returned object is a plain copy of this Call's op-shaped
   * fields, matching the shape `buildAddOp` / `buildRemoveOp`
   * produced pre-CR-1.
   */
  toOp(): CipherstashOp {
    return {
      id: this.id,
      label: this.label,
      operationClass: this.operationClass,
      invariantId: this.invariantId,
      target: this.target,
      precheck: this.precheck,
      execute: this.execute,
      postcheck: this.postcheck,
    };
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
interface AddArgs {
  readonly table: string;
  readonly column: string;
  readonly index: CipherstashSearchIndex;
  readonly castAs: string;
}

export class CipherstashAddSearchConfigCall extends CipherstashOpFactoryCallNode {
  readonly id: string;
  readonly label: string;
  readonly operationClass: 'additive';
  readonly invariantId: string;
  readonly target: { readonly id: string };
  readonly precheck: readonly OpStep[];
  readonly execute: readonly OpStep[];
  readonly postcheck: readonly OpStep[];

  // Private slot keeps the renderer-side args off the enumerable
  // own-property surface; the public accessors below expose them
  // read-only on the prototype, so neither `Object.keys` nor
  // `canonicalizeJson` walks them.
  readonly #args: AddArgs;

  constructor(
    table: string,
    column: string,
    index: CipherstashSearchIndex,
    castAs: string = DEFAULT_CAST_AS,
  ) {
    super();
    this.#args = { table, column, index, castAs };
    // Property assignment order matches the literal record
    // `buildAddOp` produced pre-CR-1 (id → label → operationClass →
    // invariantId → target → precheck → execute → postcheck), so
    // `JSON.stringify(call)` lays out keys in the same byte order the
    // baseline `ops.json` carries.
    this.id = `cipherstash-codec.${table}.${column}.add-search-config.${index}`;
    this.label = `Register cipherstash search config (${index}) for ${table}.${column}`;
    this.operationClass = 'additive';
    this.invariantId = invariantIdFor(table, column, 'add-search-config', index);
    this.target = { id: 'postgres' };
    this.precheck = [];
    this.execute = [
      {
        description: `Register cipherstash ${index} search config for ${table}.${column}`,
        sql: `SELECT eql_v2.add_search_config(${sqlLiteral(table)}, ${sqlLiteral(column)}, ${sqlLiteral(index)}, ${sqlLiteral(castAs)});`,
      },
    ];
    this.postcheck = [];
    this.freeze();
  }

  get factoryName(): 'cipherstashAddSearchConfig' {
    return 'cipherstashAddSearchConfig';
  }

  get table(): string {
    return this.#args.table;
  }

  get column(): string {
    return this.#args.column;
  }

  get index(): CipherstashSearchIndex {
    return this.#args.index;
  }

  get castAs(): string {
    return this.#args.castAs;
  }

  renderTypeScript(): string {
    const args = {
      table: this.#args.table,
      column: this.#args.column,
      index: this.#args.index,
      ...(this.#args.castAs !== DEFAULT_CAST_AS ? { castAs: this.#args.castAs } : {}),
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
interface RemoveArgs {
  readonly table: string;
  readonly column: string;
  readonly index: CipherstashSearchIndex;
}

export class CipherstashRemoveSearchConfigCall extends CipherstashOpFactoryCallNode {
  readonly id: string;
  readonly label: string;
  readonly operationClass: 'destructive';
  readonly invariantId: string;
  readonly target: { readonly id: string };
  readonly precheck: readonly OpStep[];
  readonly execute: readonly OpStep[];
  readonly postcheck: readonly OpStep[];

  readonly #args: RemoveArgs;

  constructor(table: string, column: string, index: CipherstashSearchIndex) {
    super();
    this.#args = { table, column, index };
    this.id = `cipherstash-codec.${table}.${column}.remove-search-config.${index}`;
    this.label = `Remove cipherstash search config (${index}) for ${table}.${column}`;
    this.operationClass = 'destructive';
    this.invariantId = invariantIdFor(table, column, 'remove-search-config', index);
    this.target = { id: 'postgres' };
    this.precheck = [];
    this.execute = [
      {
        description: `Remove cipherstash ${index} search config for ${table}.${column}`,
        sql: `SELECT eql_v2.remove_search_config(${sqlLiteral(table)}, ${sqlLiteral(column)}, ${sqlLiteral(index)});`,
      },
    ];
    this.postcheck = [];
    this.freeze();
  }

  get factoryName(): 'cipherstashRemoveSearchConfig' {
    return 'cipherstashRemoveSearchConfig';
  }

  get table(): string {
    return this.#args.table;
  }

  get column(): string {
    return this.#args.column;
  }

  get index(): CipherstashSearchIndex {
    return this.#args.index;
  }

  renderTypeScript(): string {
    return `cipherstashRemoveSearchConfig(${jsonToTsSource({
      table: this.#args.table,
      column: this.#args.column,
      index: this.#args.index,
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
 *
 * Returns the {@link CipherstashAddSearchConfigCall} IR node, which
 * implements `OpFactoryCall` and is itself a `SqlMigrationPlanOperation`
 * (its readonly op-shaped fields are populated in the constructor) — so
 * the same value flows through both the renderer (planner-time IR) and
 * the runtime ops list (`Migration.operations`) without an extra
 * lowering step at the call site.
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
 *
 * Returns the {@link CipherstashRemoveSearchConfigCall} IR node — see
 * {@link cipherstashAddSearchConfig} for the rationale.
 */
export function cipherstashRemoveSearchConfig(
  args: CipherstashSearchConfigArgs,
): CipherstashRemoveSearchConfigCall {
  return new CipherstashRemoveSearchConfigCall(args.table, args.column, args.index);
}
