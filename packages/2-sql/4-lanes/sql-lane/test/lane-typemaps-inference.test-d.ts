import type { CodecTypesOf, ExtractTypeMapsFromContract } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { expectTypeOf, test } from 'vitest';
import { sql } from '../src/sql/builder';
import type { CodecTypes, Contract, TypeMaps } from './fixtures/contract.d';
import contractJson from './fixtures/contract.json' with { type: 'json' };

test('schema with explicit TypeMaps infers column types', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);

  const schemaHandle = schema<Contract, TypeMaps>(context);
  const userTable = schemaHandle.tables.user!;

  expectTypeOf(schemaHandle.tables).toHaveProperty('user');
  expectTypeOf(userTable.columns.id).toBeObject();
});

test('sql with explicit TypeMaps infers Row type from projection', () => {
  const contract = validateContract<Contract>(contractJson);
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const schemaHandle = schema<Contract, TypeMaps>(context);
  const userTable = schemaHandle.tables.user!;

  const _plan = sql<Contract, TypeMaps>({ context })
    .from(userTable)
    .select({
      id: userTable.columns.id,
      email: userTable.columns.email,
    })
    .build();

  type Row = ResultType<typeof _plan>;
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['email']>().toEqualTypeOf<string>();
});

test('CodecTypesOf extracts from explicit TypeMaps', () => {
  type CT = CodecTypesOf<TypeMaps>;
  expectTypeOf<CT>().toExtend<CodecTypes>();
  expectTypeOf<CT['pg/int4@1']['output']>().toEqualTypeOf<number>();
});

test('ExtractTypeMapsFromContract extracts from phantom-key contract', () => {
  type Extracted = ExtractTypeMapsFromContract<Contract>;
  expectTypeOf<Extracted>().toExtend<TypeMaps>();
});
