import type { CoreHashBase } from '@prisma-next/contract/types';
import type { SqlContract } from '@prisma-next/sql-contract/types';
import { createRef, createRoot, type SelectBuilder, type TableReference } from './src';

type CoreHash = CoreHashBase<'core-hash-example'>;
type AnotherCoreHash = CoreHashBase<'another-core-hash-example'>;

declare const contract: SqlContract<
  {
    readonly tables: {
      readonly users: {
        readonly columns: {
          readonly id: {
            readonly codecId: 'pg/int8@1';
            readonly nativeType: 'serial';
            nullable: false;
          };
          readonly email: {
            readonly codecId: 'pg/varchar@1';
            readonly nativeType: 'varchar';
            nullable: true;
          };
        };
        readonly foreignKeys: [];
        readonly indexes: [];
        readonly uniques: [];
      };
      readonly posts: {
        readonly columns: {
          readonly id: {
            readonly codecId: 'pg/int8@1';
            readonly nativeType: 'serial';
            nullable: false;
          };
          readonly authorId: {
            readonly codecId: 'pg/int8@1';
            readonly nativeType: 'int8';
            nullable: true;
          };
        };
        readonly foreignKeys: [];
        readonly indexes: [];
        readonly uniques: [];
      };
    };
  },
  Record<string, unknown>,
  Record<string, unknown>,
  {
    readonly codecTypes: {
      'pg/int8@1': { output: number };
      'pg/varchar@1': { output: string };
    };
    readonly operationTypes: Record<string, Record<string, unknown>>;
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

root.from(ref.users).select(ref['*']).build();
root.from(ref.posts).select(ref.posts['*']).build();

// testing multi-table select * type error
(
  root.from(ref.users) as SelectBuilder<
    typeof contract,
    {
      users: (typeof contract)['storage']['tables']['users'];
      posts: (typeof contract)['storage']['tables']['posts'];
    }
  >
)
  .select(ref['*'])
  // @ts-expect-error
  .build();

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
