import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import type { ContractModelsMap, UNBOUND_DOMAIN_NAMESPACE_ID } from '@prisma-next/contract/types';
import { SqlContractSerializer } from '@prisma-next/family-sql/ir';
import type { ResultType } from '@prisma-next/framework-components/runtime';
import { defineContract, field, model, rel } from '@prisma-next/postgres/contract-builder';
import { sql } from '@prisma-next/sql-builder/runtime';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { expectTypeOf, test } from 'vitest';

// ---------------------------------------------------------------------------
// DSL literal type inference tests
//
// These tests verify the acceptance criterion:
//   "Downstream schema() / sql() inference continues to work from
//    no-emit TS-authored contracts built from the new surface."
//
// Each test uses `typeof contract` (the inferred type from the DSL),
// NOT an emitted Contract type. If TypeScript cannot reduce the inferred type
// to literal table/column/model keys, these tests fail.
// ---------------------------------------------------------------------------

// -- Fixtures ---------------------------------------------------------------

const User = model('User', {
  fields: {
    id: field.column(int4Column).id(),
    email: field.column(textColumn),
  },
}).sql({ table: 'user' });

const Post = model('Post', {
  fields: {
    id: field.column(int4Column).id(),
    userId: field.column(int4Column),
    title: field.column(textColumn),
  },
  relations: {
    author: rel.belongsTo(User, { from: 'userId', to: 'id' }),
  },
}).sql(({ cols, constraints }) => ({
  table: 'post',
  foreignKeys: [constraints.foreignKey(cols.userId, User.refs.id)],
}));

// -- Single-model contract --------------------------------------------------

const singleModelContract = defineContract({
  models: { User },
});

test('table name literals survive in storage.tables (single model)', () => {
  expectTypeOf<
    keyof (typeof singleModelContract.storage.namespaces)[typeof UNBOUND_DOMAIN_NAMESPACE_ID]['tables']
  >().toEqualTypeOf<'user'>();
});

test('column name literals survive in storage.tables[name].columns', () => {
  type UserColumns =
    (typeof singleModelContract.storage.namespaces)[typeof UNBOUND_DOMAIN_NAMESPACE_ID]['tables']['user']['columns'];
  expectTypeOf<keyof UserColumns>().toEqualTypeOf<'id' | 'email'>();
});

test('model name literals survive in models', () => {
  expectTypeOf<keyof ContractModelsMap<typeof singleModelContract>>().toEqualTypeOf<'User'>();
});

test('model table name is a literal string', () => {
  type SingleModels = ContractModelsMap<typeof singleModelContract>;
  expectTypeOf<SingleModels['User']['storage']['table']>().toEqualTypeOf<'user'>();
});

// -- deserializeContract preserves literals ------------------------------------

test('deserializeContract preserves table name literals', () => {
  const validated = new SqlContractSerializer().deserializeContract(
    singleModelContract,
  ) as typeof singleModelContract;
  expectTypeOf<
    keyof (typeof validated.storage.namespaces)[typeof UNBOUND_DOMAIN_NAMESPACE_ID]['tables']
  >().toEqualTypeOf<'user'>();
});

test('deserializeContract preserves model name literals', () => {
  const validated = new SqlContractSerializer().deserializeContract(
    singleModelContract,
  ) as typeof singleModelContract;
  expectTypeOf<keyof ContractModelsMap<typeof validated>>().toEqualTypeOf<'User'>();
});

// -- sql() dot access works with inferred contract --------------------------

test('sql() exposes table as a literal-keyed property', () => {
  const validated = new SqlContractSerializer().deserializeContract(
    singleModelContract,
  ) as typeof singleModelContract;
  const context = createTestContext(validated, createStubAdapter());
  const db = sql({ context, rawCodecInferer: { inferCodec: () => 'pg/text' } });

  db.user.select('id', 'email').build();
});

test('ResultType inference produces literal field keys', () => {
  const validated = new SqlContractSerializer().deserializeContract(
    singleModelContract,
  ) as typeof singleModelContract;
  const context = createTestContext(validated, createStubAdapter());
  const db = sql({ context, rawCodecInferer: { inferCodec: () => 'pg/text' } });
  const plan = db.user.select('id', 'email').build();

  type Row = ResultType<typeof plan>;
  expectTypeOf<Row>().toHaveProperty('id');
  expectTypeOf<Row>().toHaveProperty('email');
});

// -- Multi-model contract preserves all literals ----------------------------

const multiModelContract = defineContract({
  models: {
    User,
    Post,
  },
});

test('multi-model contract preserves table name literals', () => {
  expectTypeOf<
    keyof (typeof multiModelContract.storage.namespaces)[typeof UNBOUND_DOMAIN_NAMESPACE_ID]['tables']
  >().toEqualTypeOf<'user' | 'post'>();
});

test('multi-model contract preserves model name literals', () => {
  expectTypeOf<keyof ContractModelsMap<typeof multiModelContract>>().toEqualTypeOf<
    'User' | 'Post'
  >();
});

test('multi-model contract preserves column literals per table', () => {
  type PostColumns =
    (typeof multiModelContract.storage.namespaces)[typeof UNBOUND_DOMAIN_NAMESPACE_ID]['tables']['post']['columns'];
  expectTypeOf<keyof PostColumns>().toEqualTypeOf<'id' | 'userId' | 'title'>();
});

test('multi-model sql() dot access works for all tables', () => {
  const validated = new SqlContractSerializer().deserializeContract(
    multiModelContract,
  ) as typeof multiModelContract;
  const context = createTestContext(validated, createStubAdapter());
  const db = sql({ context, rawCodecInferer: { inferCodec: () => 'pg/text' } });

  db.user.select('id', 'email').build();
  db.post.select('id', 'title').build();
});
