import type { SqlContract, SqlMappings, SqlStorage } from '@prisma-next/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { RuntimeContext, TypeHelperRegistry } from '../src/sql-context';

// Contract type with storage.types using literal types (matching emission output)
type TestContract = SqlContract<
  {
    readonly tables: {
      readonly document: {
        readonly columns: {
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            nullable: false;
          };
        };
        readonly primaryKey: { readonly columns: readonly ['id'] };
        readonly uniques: readonly [];
        readonly indexes: readonly [];
        readonly foreignKeys: readonly [];
      };
    };
    readonly types: {
      readonly Vector1536: {
        readonly codecId: 'pg/vector@1';
        readonly nativeType: 'vector';
        readonly typeParams: { readonly length: 1536 };
      };
    };
  },
  Record<string, never>,
  Record<string, never>,
  SqlMappings
>;

test('RuntimeContext.types is TypeHelperRegistry', () => {
  // RuntimeContext.types is intentionally loose (Record<string, unknown>)
  // The strong typing comes from schema(context).types via ExtractSchemaTypes
  expectTypeOf<RuntimeContext<TestContract>['types']>().toEqualTypeOf<
    TypeHelperRegistry | undefined
  >();

  // TypeHelperRegistry allows any values - the actual type depends on init hooks
  expectTypeOf<TypeHelperRegistry>().toEqualTypeOf<Record<string, unknown>>();
});

test('RuntimeContext preserves contract type parameter', () => {
  // Verify the contract type is preserved in RuntimeContext
  expectTypeOf<RuntimeContext<TestContract>['contract']>().toEqualTypeOf<TestContract>();

  // Verify we can access storage.types through the context's contract
  type ContractStorageTypes = RuntimeContext<TestContract>['contract']['storage']['types'];
  expectTypeOf<ContractStorageTypes>().toExtend<
    | {
        readonly Vector1536: {
          readonly codecId: 'pg/vector@1';
          readonly nativeType: 'vector';
          readonly typeParams: { readonly length: 1536 };
        };
      }
    | undefined
  >();
});

test('RuntimeContext accepts generic SqlContract', () => {
  // Verify RuntimeContext defaults work
  type DefaultContext = RuntimeContext;
  expectTypeOf<DefaultContext['contract']>().toExtend<SqlContract<SqlStorage>>();
  expectTypeOf<DefaultContext['types']>().toEqualTypeOf<TypeHelperRegistry | undefined>();
});
