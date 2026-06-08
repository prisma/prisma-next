import type { ControlPolicy } from '@prisma-next/contract/types';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { CheckConstraint, type CheckConstraintInput } from './check-constraint';
import { ForeignKey, type ForeignKeyInput } from './foreign-key';
import { PrimaryKey, type PrimaryKeyInput } from './primary-key';
import { Index, type IndexInput } from './sql-index';
import { SqlNode } from './sql-node';
import { StorageColumn, type StorageColumnInput } from './storage-column';
import { UniqueConstraint, type UniqueConstraintInput } from './unique-constraint';

export type RlsMode = 'auto' | 'enabled' | 'disabled';

export interface StorageTableInput {
  readonly columns: Record<string, StorageColumn | StorageColumnInput>;
  readonly primaryKey?: PrimaryKey | PrimaryKeyInput;
  readonly uniques: ReadonlyArray<UniqueConstraint | UniqueConstraintInput>;
  readonly indexes: ReadonlyArray<Index | IndexInput>;
  readonly foreignKeys: ReadonlyArray<ForeignKey | ForeignKeyInput>;
  readonly control?: ControlPolicy;
  readonly checks?: ReadonlyArray<CheckConstraint | CheckConstraintInput>;
  /**
   * Row-level security mode for this table. `'auto'` (default) leaves RLS
   * management to the migration planner; `'enabled'` / `'disabled'` force
   * `ALTER TABLE … ENABLE/DISABLE ROW LEVEL SECURITY`. Absent-when-default:
   * the property is only set when the value differs from `'auto'`, mirroring
   * the `control?` discipline.
   */
  readonly rls?: RlsMode;
}

/**
 * SQL Contract IR node for a single table entry in a namespace's
 * `tables` map.
 *
 * The constructor normalises nested IR-class fields (columns, primary
 * key, uniques, indexes, foreign keys) into the appropriate class
 * instances so downstream walks see a uniform AST regardless of whether
 * the input was a JSON literal or an already-constructed class.
 *
 * The table's `name` is not on the class — tables are keyed by name in
 * the parent namespace's `tables: Record<string, StorageTable>` map.
 */
export class StorageTable extends SqlNode {
  readonly columns: Readonly<Record<string, StorageColumn>>;
  readonly uniques: ReadonlyArray<UniqueConstraint>;
  readonly indexes: ReadonlyArray<Index>;
  readonly foreignKeys: ReadonlyArray<ForeignKey>;
  declare readonly primaryKey?: PrimaryKey;
  declare readonly control?: ControlPolicy;
  declare readonly checks?: ReadonlyArray<CheckConstraint>;
  declare readonly rls?: RlsMode;

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
    if (input.control !== undefined) this.control = input.control;
    if (input.checks !== undefined && input.checks.length > 0) {
      this.checks = Object.freeze(input.checks.map((cc) => new CheckConstraint(cc)));
    }
    if (input.rls !== undefined && input.rls !== 'auto') this.rls = input.rls;
    freezeNode(this);
  }
}
