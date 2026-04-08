import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import sqlFamilyPack from '@prisma-next/family-sql/pack';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import { sql } from '@prisma-next/sql-builder/runtime';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { defineContract, field, model, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import postgresPack from '@prisma-next/target-postgres/pack';
import { expectTypeOf, test } from 'vitest';

// ---------------------------------------------------------------------------
// Staged DSL literal type inference tests
//
// These tests verify the acceptance criterion:
//   "Downstream schema() / sql() inference continues to work from
//    no-emit TS-authored contracts built from the new surface."
//
// Each test uses `typeof contract` (the inferred type from the staged DSL),
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
  family: sqlFamilyPack,
  target: postgresPack,
  models: { User },
});

test('table name literals survive in storage.tables (single model)', () => {
  expectTypeOf<keyof typeof singleModelContract.storage.tables>().toEqualTypeOf<'user'>();
});

test('column name literals survive in storage.tables[name].columns', () => {
  type UserColumns = (typeof singleModelContract.storage.tables)['user']['columns'];
  expectTypeOf<keyof UserColumns>().toEqualTypeOf<'id' | 'email'>();
});

test('model name literals survive in models', () => {
  expectTypeOf<keyof typeof singleModelContract.models>().toEqualTypeOf<'User'>();
});

test('model table name is a literal string', () => {
  expectTypeOf(singleModelContract.models.User.storage.table).toEqualTypeOf<'user'>();
});

// -- validateContract preserves literals ------------------------------------

test('validateContract preserves table name literals', () => {
  const validated = validateContract<typeof singleModelContract>(
    singleModelContract,
    emptyCodecLookup,
  );
  expectTypeOf<keyof typeof validated.storage.tables>().toEqualTypeOf<'user'>();
});

test('validateContract preserves model name literals', () => {
  const validated = validateContract<typeof singleModelContract>(
    singleModelContract,
    emptyCodecLookup,
  );
  expectTypeOf<keyof typeof validated.models>().toEqualTypeOf<'User'>();
});

// -- sql() dot access works with inferred contract --------------------------

test('sql() exposes table as a literal-keyed property', () => {
  const validated = validateContract<typeof singleModelContract>(
    singleModelContract,
    emptyCodecLookup,
  );
  const context = createTestContext(validated, createStubAdapter());
  const db = sql({ context });

  db.user.select('id', 'email').build();
});

test('ResultType inference produces literal field keys', () => {
  const validated = validateContract<typeof singleModelContract>(
    singleModelContract,
    emptyCodecLookup,
  );
  const context = createTestContext(validated, createStubAdapter());
  const db = sql({ context });
  const plan = db.user.select('id', 'email').build();

  type Row = ResultType<typeof plan>;
  expectTypeOf<Row>().toHaveProperty('id');
  expectTypeOf<Row>().toHaveProperty('email');
});

// -- Multi-model contract preserves all literals ----------------------------

const multiModelContract = defineContract({
  family: sqlFamilyPack,
  target: postgresPack,
  models: {
    User,
    Post,
  },
});

test('multi-model contract preserves table name literals', () => {
  expectTypeOf<keyof typeof multiModelContract.storage.tables>().toEqualTypeOf<'user' | 'post'>();
});

test('multi-model contract preserves model name literals', () => {
  expectTypeOf<keyof typeof multiModelContract.models>().toEqualTypeOf<'User' | 'Post'>();
});

test('multi-model contract preserves column literals per table', () => {
  type PostColumns = (typeof multiModelContract.storage.tables)['post']['columns'];
  expectTypeOf<keyof PostColumns>().toEqualTypeOf<'id' | 'userId' | 'title'>();
});

test('multi-model sql() dot access works for all tables', () => {
  const validated = validateContract<typeof multiModelContract>(
    multiModelContract,
    emptyCodecLookup,
  );
  const context = createTestContext(validated, createStubAdapter());
  const db = sql({ context });

  db.user.select('id', 'email').build();
  db.post.select('id', 'title').build();
});
