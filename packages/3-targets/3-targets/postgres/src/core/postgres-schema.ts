import {
  freezeNode,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';

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
 *
 * **Freeze-trap warning.** The constructor calls `freezeNode(this)` at
 * the end. Direct subclasses MUST NOT add instance fields — the freeze
 * runs in this base constructor and any subclass field assignment will
 * silently fail in non-strict mode or throw in strict mode. The
 * `PostgresUnboundSchema` singleton below is intentionally field-free
 * for this reason; if a future subclass needs to carry additional
 * fields, lift this `freezeNode` to the leaf-class constructors (or to
 * a `seal()` hook each leaf calls explicitly).
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

  constructor(id: string) {
    super();
    this.id = id;
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
    super(UNBOUND_NAMESPACE_ID);
  }

  override qualifier(): string {
    return '';
  }

  override qualifyTable(tableName: string): string {
    return `"${tableName}"`;
  }
}

PostgresSchema.unbound = PostgresUnboundSchema.instance;

/**
 * Target-supplied `Namespace` factory the Postgres target plumbs
 * through `defineContract({ createNamespace })` and the SQL PSL
 * interpreter. Returns the unbound singleton for the framework
 * sentinel and a fresh `PostgresSchema(id)` for any other coordinate.
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
  return new PostgresSchema(id);
}
