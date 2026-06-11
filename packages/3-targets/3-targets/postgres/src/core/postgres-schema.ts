import {
  freezeNode,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import {
  type PostgresEnumStorageEntry,
  type SqlNamespaceTablesInput,
  type SqlStorage,
  StorageTable,
  type StorageTableInput,
  StorageValueSet,
  type StorageValueSetInput,
} from '@prisma-next/sql-contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import { PostgresEnumType, type PostgresEnumTypeInput } from './postgres-enum-type';
import { escapeLiteral } from './sql-utils';

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
 * `entries` holds entity-kind maps (`table`, `type`). Qualifier
 * emission is the rendering seam: DDL / SQL emission asks the namespace
 * for its qualifier (`"<schema>"`) or for a qualified table name
 * (`"<schema>"."<table>"`) and consumes the result polymorphically.
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

  declare readonly kind: 'schema';
  readonly id: string;
  readonly entries: Readonly<Record<string, Readonly<Record<string, unknown>>>>;

  constructor(input: PostgresSchemaInput) {
    super();
    this.id = input.id;

    const builtEntries: Record<string, Readonly<Record<string, unknown>>> = {};
    for (const [kind, rawMap] of Object.entries(input.entries)) {
      if (kind === 'table') {
        const tableMap: Record<string, StorageTable> = {};
        for (const [name, v] of Object.entries(
          blindCast<
            Record<string, StorageTable | StorageTableInput>,
            'entries[table] holds StorageTable or StorageTableInput by construction'
          >(rawMap),
        )) {
          tableMap[name] =
            v instanceof StorageTable
              ? v
              : new StorageTable(
                  blindCast<StorageTableInput, 'table entry is StorageTableInput by construction'>(
                    v,
                  ),
                );
        }
        builtEntries['table'] = Object.freeze(tableMap);
      } else if (kind === 'type') {
        const typeMap: Record<string, PostgresEnumType> = {};
        for (const [name, v] of Object.entries(
          blindCast<
            Record<string, PostgresEnumType | PostgresEnumTypeInput>,
            'entries[type] holds PostgresEnumType or PostgresEnumTypeInput by construction'
          >(rawMap),
        )) {
          typeMap[name] =
            v instanceof PostgresEnumType
              ? v
              : new PostgresEnumType(
                  blindCast<
                    PostgresEnumTypeInput,
                    'type entry is PostgresEnumTypeInput by construction'
                  >(v),
                );
        }
        builtEntries['type'] = Object.freeze(typeMap);
      } else if (kind === 'valueSet') {
        const vsMap: Record<string, StorageValueSet> = {};
        for (const [name, v] of Object.entries(
          blindCast<
            Record<string, StorageValueSet | StorageValueSetInput>,
            'entries[valueSet] holds StorageValueSet or StorageValueSetInput by construction'
          >(rawMap),
        )) {
          vsMap[name] =
            v instanceof StorageValueSet
              ? v
              : new StorageValueSet(
                  blindCast<
                    StorageValueSetInput,
                    'valueSet entry is StorageValueSetInput by construction'
                  >(v),
                );
        }
        builtEntries['valueSet'] = Object.freeze(vsMap);
      } else {
        throw new Error(
          `PostgresSchema: unknown entity kind "${kind}" in entries; expected "table", "type", or "valueSet"`,
        );
      }
    }

    if (!Object.hasOwn(builtEntries, 'table')) {
      builtEntries['table'] = Object.freeze({});
    }
    if (!Object.hasOwn(builtEntries, 'type')) {
      builtEntries['type'] = Object.freeze({});
    }

    const valueSetMap = builtEntries['valueSet'];
    if (valueSetMap !== undefined && Object.keys(valueSetMap).length > 0) {
      this.entries = Object.freeze(builtEntries);
    } else {
      delete builtEntries['valueSet'];
      this.entries = Object.freeze(builtEntries);
    }
    Object.defineProperty(this, 'kind', {
      value: 'schema',
      writable: false,
      enumerable: false,
      configurable: true,
    });
    freezeNode(this);
  }

  get table(): Readonly<Record<string, StorageTable>> {
    return blindCast<
      Readonly<Record<string, StorageTable>>,
      'entries[table] holds only StorageTable by construction'
    >(this.entries['table'] ?? Object.freeze({}));
  }

  get type(): Readonly<Record<string, PostgresEnumType>> {
    return blindCast<
      Readonly<Record<string, PostgresEnumType>>,
      'entries[type] holds only PostgresEnumType by construction'
    >(this.entries['type'] ?? Object.freeze({}));
  }

  get valueSet(): Readonly<Record<string, StorageValueSet>> | undefined {
    const vs = this.entries['valueSet'];
    if (vs === undefined) return undefined;
    return blindCast<
      Readonly<Record<string, StorageValueSet>>,
      'entries[valueSet] holds only StorageValueSet by construction'
    >(vs);
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
   * The bare schema name a DDL planner should target when emitting
   * statements that need to identify this namespace in the live
   * database (e.g. `CREATE TABLE "<ddlSchemaName>"."<table>" …`,
   * catalog filters, planner conflict lookups). Named schemas resolve
   * to their own id. The `PostgresUnboundSchema` singleton inherits
   * this and returns `UNBOUND_NAMESPACE_ID` — callers that dispatch
   * through `qualifyTableName` / `toRegclassLiteral` route through the
   * polymorphic `PostgresUnboundSchema` overrides and produce
   * unqualified (search-path-resolved) output automatically.
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
 * `UNBOUND_NAMESPACE_ID`. Downstream helpers (`qualifyTableName`,
 * `toRegclassLiteral`) route through the polymorphic factory and
 * produce unqualified output automatically.
 */
export class PostgresUnboundSchema extends PostgresSchema {
  static readonly instance: PostgresUnboundSchema = new PostgresUnboundSchema();

  constructor(input?: PostgresSchemaInput) {
    super(input ?? { id: UNBOUND_NAMESPACE_ID, entries: { table: {}, type: {} } });
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
export function postgresCreateNamespace(
  input: SqlNamespaceTablesInput,
  enumTypes?: Readonly<Record<string, PostgresEnumStorageEntry>>,
): PostgresSchema {
  const inputTable = input.entries['table'] ?? {};
  const inputValueSet = input.entries['valueSet'];
  const schemaInput: PostgresSchemaInput = {
    id: input.id,
    entries: {
      table: inputTable,
      type: blindCast<
        Record<string, PostgresEnumTypeInput>,
        'enumTypes values are PostgresEnumTypeInput by construction'
      >(enumTypes ?? {}),
      ...(inputValueSet !== undefined ? { valueSet: inputValueSet } : {}),
    },
  };
  if (input.id === UNBOUND_NAMESPACE_ID) {
    return new PostgresUnboundSchema(schemaInput);
  }
  return new PostgresSchema(schemaInput);
}
