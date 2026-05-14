import type { StorageHashBase } from '@prisma-next/contract/types';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlNode } from './sql-node';
import { StorageTable, type StorageTableInput } from './storage-table';
import { StorageTypeInstance, type StorageTypeInstanceInput } from './storage-type-instance';

export interface SqlStorageInput<THash extends string = string> {
  readonly storageHash: StorageHashBase<THash>;
  readonly tables: Record<string, StorageTable | StorageTableInput>;
  readonly types?: Record<string, StorageTypeInstance | StorageTypeInstanceInput>;
}

/**
 * SQL Contract IR root node for the `storage` field.
 *
 * Single concrete family-shared class — both Postgres and SQLite
 * consume this same class today. A future milestone introduces
 * per-target storage subclasses when each target's namespace shape
 * earns its target-specific concretion (target-specific derived
 * fields, target-specific storage extensions).
 *
 * The constructor normalises nested IR-class fields (`tables`, optional
 * `types`) into class instances so downstream walks see a uniform AST.
 */
export class SqlStorage<THash extends string = string> extends SqlNode {
  readonly storageHash: StorageHashBase<THash>;
  readonly tables: Readonly<Record<string, StorageTable>>;
  declare readonly types?: Readonly<Record<string, StorageTypeInstance>>;

  constructor(input: SqlStorageInput<THash>) {
    super();
    this.storageHash = input.storageHash;
    this.tables = Object.freeze(
      Object.fromEntries(
        Object.entries(input.tables).map(([name, t]) => [
          name,
          t instanceof StorageTable ? t : new StorageTable(t),
        ]),
      ),
    );
    if (input.types !== undefined) {
      this.types = Object.freeze(
        Object.fromEntries(
          Object.entries(input.types).map(([name, ti]) => [
            name,
            ti instanceof StorageTypeInstance ? ti : new StorageTypeInstance(ti),
          ]),
        ),
      );
    }
    freezeNode(this);
  }
}
