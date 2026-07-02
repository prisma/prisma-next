import type { Contract } from '@prisma-next/contract/types';
import {
  freezeNode,
  hydrateNamespaceEntities,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { composeSqlEntityKinds } from '@prisma-next/sql-contract/entity-kinds';
import {
  SqlNamespaceBase,
  type SqlNamespaceEntries,
  type SqlNamespaceInput,
  type SqlStorage,
  type StorageTable,
  type StorageValueSet,
} from '@prisma-next/sql-contract/types';

import { type CfExpr, cfExpr } from '@prisma-next/sql-relational-core/contract-free';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import { PostgresTableSource } from './ast/table-source';
import { PG_TEXT_CODEC_ID } from './codec-ids';
import { nativeEnumEntityKind, policyEntityKind, roleEntityKind } from './entity-kinds';
import type { PostgresNativeEnum } from './schema-ir/postgres-native-enum';
import type { PostgresRlsPolicy } from './schema-ir/postgres-rls-policy';
import type { PostgresRole } from './schema-ir/postgres-role';
import { escapeLiteral } from './sql-utils';

export type PostgresContract = Contract<SqlStorage> & { readonly target: 'postgres' };

export type PostgresNamespaceEntries = SqlNamespaceEntries & {
  readonly policy?: Readonly<Record<string, PostgresRlsPolicy>>;
  readonly role?: Readonly<Record<string, PostgresRole>>;
  readonly native_enum?: Readonly<Record<string, PostgresNativeEnum>>;
};

export interface PostgresSchemaInput {
  readonly id: string;
  readonly entries: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/**
 * Postgres target `Namespace` concretion — a Postgres schema (`CREATE
 * SCHEMA …`). Each Postgres `SqlStorage` carries a
 * `namespaces: Record<NamespaceId, PostgresSchema>` map populated by
 * the Postgres PSL interpreter from `namespace { … }` AST buckets.
 *
 * `entries` holds entity-kind maps (`table`, `valueSet`). Qualifier
 * emission is the rendering seam: DDL / SQL emission asks the namespace
 * for its qualifier (`"<schema>"`) or for a qualified table name
 * (`"<schema>"."<table>"`) and consumes the result polymorphically.
 * The unbound singleton below overrides these methods to elide the
 * prefix entirely — call sites stay polymorphic and never branch on
 * `id === UNBOUND_NAMESPACE_ID`.
 */
export class PostgresSchema extends SqlNamespaceBase {
  /**
   * Stable singleton reference for the late-bound slot. Materialised
   * lazily below the singleton subclass declaration so the static
   * initialiser sees the subclass before assigning. Consumers always
   * reach for `PostgresSchema.unbound` (or `PostgresUnboundSchema.instance`
   * — same identity).
   */
  static unbound: PostgresUnboundSchema;

  declare readonly kind: 'schema';
  readonly id: string;
  readonly entries: PostgresNamespaceEntries;

  constructor(input: PostgresSchemaInput) {
    super();
    this.id = input.id;

    const dispatched = hydrateNamespaceEntities(
      input.entries,
      composeSqlEntityKinds([policyEntityKind, roleEntityKind, nativeEnumEntityKind]),
      'carry',
    );

    // Drop an empty valueSet so presence signals non-emptiness.
    const valueSetRaw = dispatched['valueSet'];
    const withPresence =
      valueSetRaw !== undefined && Object.keys(valueSetRaw).length === 0
        ? { ...dispatched, valueSet: undefined }
        : dispatched;

    this.entries = Object.freeze(
      blindCast<
        PostgresNamespaceEntries,
        'composeSqlEntityKinds([policyEntityKind, roleEntityKind, nativeEnumEntityKind]) supplies table→StorageTable, valueSet→StorageValueSet, policy→PostgresRlsPolicy, role→PostgresRole, native_enum→PostgresNativeEnum descriptors'
      >(withPresence),
    );
    Object.defineProperty(this, 'kind', {
      value: 'schema',
      writable: false,
      enumerable: false,
      configurable: true,
    });
    freezeNode(this);
  }

  get table(): Readonly<Record<string, StorageTable>> {
    return this.entries.table ?? Object.freeze({});
  }

  get valueSet(): Readonly<Record<string, StorageValueSet>> | undefined {
    return this.entries.valueSet;
  }

  get policy(): Readonly<Record<string, PostgresRlsPolicy>> {
    return this.entries.policy ?? Object.freeze({});
  }

  get role(): Readonly<Record<string, PostgresRole>> {
    return this.entries.role ?? Object.freeze({});
  }

  get nativeEnum(): Readonly<Record<string, PostgresNativeEnum>> {
    return this.entries.native_enum ?? Object.freeze({});
  }

  /**
   * The bare schema qualifier as it would appear in a rendered SQL
   * fragment (already quoted). The unbound-schema singleton overrides
   * this to return `''`.
   */
  qualifier(): string {
    return `"${this.id}"`;
  }

  /**
   * Qualify a table name with the schema prefix
   * (`"<schema>"."<table>"`). The unbound-schema singleton overrides
   * this to emit just `"<table>"` so the resolved DDL is unqualified
   * and `search_path` decides where the object lands at runtime.
   */
  qualifyTable(tableName: string): string {
    return `"${this.id}"."${tableName}"`;
  }

  /**
   * Render a SQL string-literal containing the qualified-name form
   * suitable for `to_regclass(...)` arguments (e.g. `'"public"."user"'`).
   * The unbound singleton overrides this to elide the schema prefix
   * (`'"user"'`) so `search_path` resolves the object at runtime.
   */
  regclassLiteral(name: string): string {
    return `'${escapeLiteral(this.qualifyTable(name))}'`;
  }

  /**
   * Render a SQL expression that evaluates to this namespace's schema
   * name at runtime, ready to drop into a `WHERE table_schema = …` /
   * `WHERE n.nspname = …` clause. Named schemas emit a quoted SQL
   * literal (`'public'`); the unbound singleton overrides this to emit
   * `current_schema()` so catalog queries match whichever schema the
   * connection's `search_path` resolved at runtime.
   */
  schemaSqlExpression(): string {
    return `'${escapeLiteral(this.id)}'`;
  }

  /**
   * Typed-AST counterpart of {@link schemaSqlExpression}: the expression a
   * builder-built catalog check compares `n.nspname` / `table_schema`
   * against. Named schemas bind the schema name as a text parameter; the
   * unbound singleton overrides this to the opaque `current_schema()`
   * expression so the live connection's `search_path` decides at runtime.
   */
  schemaFilterExpression(): CfExpr {
    return cfExpr.param(this.id, PG_TEXT_CODEC_ID);
  }

  /**
   * Typed-AST counterpart of {@link qualifyTable}: the FROM source a
   * builder-built check uses to address a user table in this namespace.
   * Named schemas qualify (`"schema"."table"`); the unbound singleton
   * overrides this to leave the table unqualified so `search_path`
   * resolves it at runtime.
   */
  tableSource(tableName: string, alias?: string): PostgresTableSource {
    return new PostgresTableSource({
      name: tableName,
      schema: this.id,
      ...ifDefined('alias', alias),
    });
  }

  /**
   * The bare schema name a DDL planner should target when emitting
   * statements that need to identify this namespace in the live
   * database (e.g. `CREATE TABLE "<ddlSchemaName>"."<table>" …`,
   * catalog filters, planner conflict lookups). Named schemas resolve
   * to their own id. The `PostgresUnboundSchema` singleton inherits
   * this and returns `UNBOUND_NAMESPACE_ID` — callers that dispatch
   * through `qualifyTableName` route through the polymorphic
   * `PostgresUnboundSchema` overrides and produce unqualified
   * (search-path-resolved) output automatically.
   */
  ddlSchemaName(_storage: SqlStorage): string {
    return this.id;
  }
}

/**
 * Singleton subclass for the reserved sentinel namespace id
 * (`UNBOUND_NAMESPACE_ID`) — the late-bound Postgres slot whose binding
 * the connection's `search_path` resolves at runtime. Overrides
 * qualifier emission to elide the schema prefix; call sites that consume
 * `qualifier()` / `qualifyTable()` get unqualified output without
 * branching on the namespace id.
 *
 * This is the target-side materialization of "the framework provides
 * affordances; targets implement specifics": the framework names the
 * sentinel; Postgres decides what late-bound means here (the table
 * name, naked — the schema is supplied by the live connection's
 * `search_path`).
 *
 * `ddlSchemaName` is inherited from `PostgresSchema` and returns
 * `UNBOUND_NAMESPACE_ID`. Downstream helpers such as `qualifyTableName`
 * route through the polymorphic factory and produce unqualified output
 * automatically.
 */
export class PostgresUnboundSchema extends PostgresSchema {
  static readonly instance: PostgresUnboundSchema = new PostgresUnboundSchema();

  constructor(input?: PostgresSchemaInput) {
    super(input ?? { id: UNBOUND_NAMESPACE_ID, entries: { table: {} } });
  }

  override qualifier(): string {
    return '';
  }

  override qualifyTable(tableName: string): string {
    return `"${tableName}"`;
  }

  override schemaSqlExpression(): string {
    return 'current_schema()';
  }

  override schemaFilterExpression(): CfExpr {
    return cfExpr.raw('current_schema()', { codecId: PG_TEXT_CODEC_ID, nullable: false });
  }

  override tableSource(tableName: string, alias?: string): PostgresTableSource {
    return new PostgresTableSource({
      name: tableName,
      ...ifDefined('alias', alias),
    });
  }
}

PostgresSchema.unbound = PostgresUnboundSchema.instance;

/**
 * Narrow an arbitrary namespace (or `undefined`) to `PostgresSchema`
 * so callers can dispatch to the polymorphic emission methods without
 * branching at the call site. Uses the structural `kind` discriminator
 * (`'schema'`) rather than `instanceof` so the check survives realm /
 * bundle / hot-reload boundaries — matching the rest of the IR's
 * narrowing convention. `PostgresUnboundSchema` passes through because
 * it inherits the same `kind: 'schema'` from `PostgresSchema`.
 */
export function isPostgresSchema(ns: unknown): ns is PostgresSchema {
  return (ns as { kind?: unknown } | null | undefined)?.kind === 'schema';
}

/**
 * Target-supplied `Namespace` factory the Postgres target plumbs
 * through `defineContract({ createNamespace })` and the SQL PSL
 * interpreter. Returns the unbound singleton for the framework
 * sentinel and a fresh `PostgresSchema` for any other coordinate.
 *
 * The factory has no per-call state — every named id deterministically
 * maps to a distinct schema instance — so callers can pass it through
 * by reference and trust the resulting `SqlStorage.namespaces` map to
 * be value-stable for a given input set.
 */
export function postgresCreateNamespace(input: SqlNamespaceInput): PostgresSchema {
  const schemaInput: PostgresSchemaInput = {
    id: input.id,
    entries: {
      ...input.entries,
      table: input.entries['table'] ?? {},
    },
  };
  if (input.id === UNBOUND_NAMESPACE_ID) {
    return new PostgresUnboundSchema(schemaInput);
  }
  return new PostgresSchema(schemaInput);
}
