import {
  freezeNode,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { StorageTable, type StorageTableInput } from '@prisma-next/sql-contract/types';
import { PostgresEnumType, type PostgresEnumTypeInput } from './postgres-enum-type';
import { escapeLiteral } from './sql-utils';

export interface PostgresSchemaInput {
  readonly id: string;
  readonly tables?: Record<string, StorageTable | StorageTableInput>;
  readonly types?: Record<string, PostgresEnumType | PostgresEnumTypeInput>;
}

/**
 * Postgres target `Namespace` concretion — a Postgres schema (`CREATE
 * SCHEMA …`). Each Postgres `SqlStorage` carries a
 * `namespaces: Record<NamespaceId, PostgresSchema>` map populated by
 * the Postgres PSL interpreter from `namespace { … }` AST buckets.
 *
 * Qualifier emission is the rendering seam: DDL / SQL emission asks the
 * namespace for its qualifier (`"<schema>"`) or for a qualified table
 * name (`"<schema>"."<table>"`) and consumes the result polymorphically.
 * The unbound singleton below overrides these methods to elide the
 * prefix entirely — call sites stay polymorphic and never branch on
 * `id === UNBOUND_NAMESPACE_ID`.
 */
export class PostgresSchema extends NamespaceBase {
  /**
   * Stable singleton reference for the late-bound slot. Materialised
   * lazily below the singleton subclass declaration so the static
   * initialiser sees the subclass before assigning. Consumers always
   * reach for `PostgresSchema.unbound` (or `PostgresUnboundSchema.instance`
   * — same identity).
   */
  static unbound: PostgresUnboundSchema;

  readonly kind = 'schema' as const;
  readonly id: string;
  readonly tables: Readonly<Record<string, StorageTable>>;
  readonly types: Readonly<Record<string, PostgresEnumType>>;

  constructor(input: PostgresSchemaInput) {
    super();
    this.id = input.id;
    this.tables = Object.freeze(
      Object.fromEntries(
        Object.entries(input.tables ?? {}).map(([name, t]) => [
          name,
          t instanceof StorageTable ? t : new StorageTable(t),
        ]),
      ),
    );
    this.types = Object.freeze(
      Object.fromEntries(
        Object.entries(input.types ?? {}).map(([name, ty]) => [
          name,
          ty instanceof PostgresEnumType ? ty : new PostgresEnumType(ty),
        ]),
      ),
    );
    freezeNode(this);
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
 */
export class PostgresUnboundSchema extends PostgresSchema {
  static readonly instance: PostgresUnboundSchema = new PostgresUnboundSchema();

  private constructor() {
    super({ id: UNBOUND_NAMESPACE_ID });
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
}

PostgresSchema.unbound = PostgresUnboundSchema.instance;

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
export function postgresCreateNamespace(id: string): PostgresSchema {
  if (id === UNBOUND_NAMESPACE_ID) {
    return PostgresSchema.unbound;
  }
  return new PostgresSchema({ id });
}
