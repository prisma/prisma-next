import { freezeNode } from '@prisma-next/framework-components/ir';
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
}

/**
 * SQL Contract IR node for a single table entry in `SqlStorage.tables`.
 * Lifted from the pre-R3 flat-data `type StorageTable` to a class
 * extending {@link SqlNode} per FR18.
 *
 * The constructor normalises nested IR-class fields (columns, primary
 * key, uniques, indexes, foreign keys) into the appropriate class
 * instances so downstream walks see a uniform AST regardless of whether
 * the input was a JSON literal or an already-constructed class.
 *
 * The table's `name` is not on the class — tables are keyed by name in
 * the parent `SqlStorage.tables: Record<string, StorageTable>` map.
 * M5a's namespace-aware re-keying will add a `namespaceId` field at
 * that milestone; today's single-namespace shape needs neither field.
 */
export class StorageTable extends SqlNode {
  readonly columns: Readonly<Record<string, StorageColumn>>;
  readonly uniques: ReadonlyArray<UniqueConstraint>;
  readonly indexes: ReadonlyArray<Index>;
  readonly foreignKeys: ReadonlyArray<ForeignKey>;
  declare readonly primaryKey?: PrimaryKey;

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
    freezeNode(this);
  }
}
