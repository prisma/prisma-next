import { freezeNode, UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { ForeignKey, type ForeignKeyInput } from './foreign-key';
import { PrimaryKey, type PrimaryKeyInput } from './primary-key';
import { Index, type IndexInput } from './sql-index';
import { SqlNode } from './sql-node';
import { StorageColumn, type StorageColumnInput } from './storage-column';
import { UniqueConstraint, type UniqueConstraintInput } from './unique-constraint';

export interface StorageTableInput {
  readonly columns: Record<string, StorageColumn | StorageColumnInput>;
  readonly primaryKey?: PrimaryKey | PrimaryKeyInput;
  readonly uniques: ReadonlyArray<UniqueConstraint | UniqueConstraintInput>;
  readonly indexes: ReadonlyArray<Index | IndexInput>;
  readonly foreignKeys: ReadonlyArray<ForeignKey | ForeignKeyInput>;
  /**
   * Namespace coordinate this table inhabits — the key into the parent
   * `SqlStorage.namespaces` map. Omitting the field (or passing the
   * framework's `UNBOUND_NAMESPACE_ID` sentinel) selects the late-bound
   * slot, which renders as unqualified DDL (Postgres `search_path`
   * resolves the schema at connection time; SQLite always emits
   * unqualified).
   */
  readonly namespaceId?: string;
}

/**
 * SQL Contract IR node for a single table entry in `SqlStorage.tables`.
 *
 * The constructor normalises nested IR-class fields (columns, primary
 * key, uniques, indexes, foreign keys) into the appropriate class
 * instances so downstream walks see a uniform AST regardless of whether
 * the input was a JSON literal or an already-constructed class.
 *
 * The table's `name` is not on the class — tables are keyed by name in
 * the parent `SqlStorage.tables: Record<string, StorageTable>` map.
 *
 * The `namespaceId` coordinate identifies which entry in the parent
 * `SqlStorage.namespaces` map the table inhabits. The runtime property
 * is always present (`UNBOUND_NAMESPACE_ID` for the late-bound default);
 * the persisted JSON envelope omits the field when it would equal the
 * default so single-namespace contracts stay byte-stable.
 */
export class StorageTable extends SqlNode {
  readonly columns: Readonly<Record<string, StorageColumn>>;
  readonly uniques: ReadonlyArray<UniqueConstraint>;
  readonly indexes: ReadonlyArray<Index>;
  readonly foreignKeys: ReadonlyArray<ForeignKey>;
  declare readonly primaryKey?: PrimaryKey;
  /**
   * Coordinate into `SqlStorage.namespaces`. The property is enumerable
   * (and therefore serialised) only when the coordinate is not the
   * default late-bound sentinel — see `get namespaceId` below for the
   * always-present runtime view.
   */
  declare readonly namespaceId: string;

  constructor(input: StorageTableInput) {
    super();
    this.columns = Object.freeze(
      Object.fromEntries(
        Object.entries(input.columns).map(([name, col]) => [
          name,
          col instanceof StorageColumn ? col : new StorageColumn(col),
        ]),
      ),
    );
    if (input.primaryKey !== undefined) {
      this.primaryKey =
        input.primaryKey instanceof PrimaryKey
          ? input.primaryKey
          : new PrimaryKey(input.primaryKey);
    }
    this.uniques = Object.freeze(
      input.uniques.map((u) => (u instanceof UniqueConstraint ? u : new UniqueConstraint(u))),
    );
    this.indexes = Object.freeze(input.indexes.map((i) => (i instanceof Index ? i : new Index(i))));
    this.foreignKeys = Object.freeze(
      input.foreignKeys.map((fk) => (fk instanceof ForeignKey ? fk : new ForeignKey(fk))),
    );
    const namespaceId = input.namespaceId ?? UNBOUND_NAMESPACE_ID;
    if (namespaceId === UNBOUND_NAMESPACE_ID) {
      Object.defineProperty(this, 'namespaceId', {
        value: UNBOUND_NAMESPACE_ID,
        enumerable: false,
        writable: false,
        configurable: false,
      });
    } else {
      Object.defineProperty(this, 'namespaceId', {
        value: namespaceId,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    freezeNode(this);
  }
}
