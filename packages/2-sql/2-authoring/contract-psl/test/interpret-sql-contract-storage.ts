import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';

/** The PSL SQL interpreter materialises `SqlStorage`; `Contract` types `storage` as the framework base. */
export function sqlStorageFromSuccessfulSqlInterpretation(contract: Contract): SqlStorage {
  return contract.storage as SqlStorage;
}
