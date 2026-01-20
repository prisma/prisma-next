import type { CoreHashBase } from '@prisma-next/contract/types';
import type { SqlContract } from '@prisma-next/sql-contract/types';
import { createRef, createRoot, type TableReference } from './src';

type CoreHash = CoreHashBase<'core-hash-example'>;
type AnotherCoreHash = CoreHashBase<'another-core-hash-example'>;

declare const contract: SqlContract<
  {
    tables: {
      users: {
        columns: {
          id: {
            codecId: 'codecid';
            nativeType: 'nativetype';
            nullable: false;
          };
        };
        foreignKeys: [];
        indexes: [];
        uniques: [];
      };
      posts: {
        columns: {
          id: {
            codecId: 'codecid';
            nativeType: 'nativetype';
            nullable: false;
          };
        };
        foreignKeys: [];
        indexes: [];
        uniques: [];
      };
    };
  },
  Record<string, unknown>,
  Record<string, unknown>,
  {
    codecTypes: Record<string, { output: unknown }>;
    operationTypes: Record<string, Record<string, unknown>>;
  },
  CoreHash
>;

declare const wrongTable: TableReference<'comments', CoreHash>;
declare const allTable: TableReference<string, CoreHash>;
declare const anyTable: TableReference<any, CoreHash>;
declare const neverTable: TableReference<never, CoreHash>;
declare const customTable: { '~name': 'users' };
// @ts-expect-error
declare const unknownTable: TableReference<unknown, CoreHash>;
declare const differentHashTable: TableReference<'users', AnotherCoreHash>;

const root = createRoot(contract);
const ref = createRef(contract);

root.from(ref.users).build();
root.from(ref.posts).build();

root
  // @ts-expect-error
  .from(allTable)
  // @ts-expect-error
  .build();
root
  .from(allTable as never)
  // @ts-expect-error
  .build();
root
  .from(allTable as any)
  // @ts-expect-error
  .build();
root
  // @ts-expect-error
  .from(anyTable)
  // @ts-expect-error
  .build();
root
  .from(neverTable)
  // @ts-expect-error
  .build();
root
  // @ts-expect-error
  .from(ref.no_such_table)
  // @ts-expect-error
  .build();
root
  // @ts-expect-error
  .from(customTable)
  // @ts-expect-error
  .build();
root
  // @ts-expect-error
  .from(unknownTable)
  // @ts-expect-error
  .build();
root
  // @ts-expect-error
  .from(differentHashTable)
  // @ts-expect-error
  .build();
