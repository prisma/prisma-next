import {
  freezeNode,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
import type { StorageTable } from './storage-table';

const FROZEN_EMPTY_TABLE: Readonly<Record<string, StorageTable>> = Object.freeze({});

/**
 * Family-layer placeholder for the SQL unbound-namespace singleton —
 * the late-bound slot whose binding the target resolves at connection
 * time rather than at authoring time.
 *
 * SQL contracts honour the framework `Storage.namespaces` invariant from
 * the moment they appear in the IR. Today `SqlStorage` is family-shared
 * (Postgres + SQLite consume the same class); a per-target namespace
 * concretion (`PostgresSchema.unbound`, `SqliteUnboundDatabase.instance`)
 * earns its existence when each target's namespace shape lands. Until
 * then the family ships a single placeholder singleton so the JSON
 * envelope and runtime walk are honest at every layer.
 *
 * The `kind` discriminator is installed as a non-enumerable own property
 * so the JSON envelope reads `{ "id": "__unbound__", "entries": { … } }`
 * — symmetric with the family-level non-enumerable `kind` on `SqlNode`
 * and bounded to the minimum data the framework `Namespace` interface
 * promises.
 *
 * **Freeze-trap warning.** The leaf constructor calls
 * `freezeNode(this)` after installing `kind`. The leaf-class shape
 * works today only because `NamespaceBase` does NOT freeze in its
 * constructor — the `Object.defineProperty(this, 'kind', …)` call after
 * `super()` succeeds because the instance is still mutable at that
 * point. Subclasses that add instance fields will still hit the freeze
 * trap once leaf-class `freezeNode(this)` runs; and if a future
 * framework change lifts the freeze to `NamespaceBase`, even the
 * `defineProperty` here would silently fail. To add subclass instance
 * fields safely, lift `freezeNode` to a leaf-class `seal()` hook each
 * leaf calls explicitly at the end of its own constructor.
 */
export class SqlUnboundNamespace extends NamespaceBase {
  static readonly instance: SqlUnboundNamespace = new SqlUnboundNamespace();

  readonly id = UNBOUND_NAMESPACE_ID;
  readonly entries: Readonly<Record<string, Readonly<Record<string, unknown>>>> = Object.freeze({
    table: FROZEN_EMPTY_TABLE,
  });
  declare readonly kind: string;

  private constructor() {
    super();
    Object.defineProperty(this, 'kind', {
      value: 'sql-namespace',
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
    >(this.entries['table'] ?? FROZEN_EMPTY_TABLE);
  }

  qualifyTable(tableName: string): string {
    return `"${tableName}"`;
  }
}
