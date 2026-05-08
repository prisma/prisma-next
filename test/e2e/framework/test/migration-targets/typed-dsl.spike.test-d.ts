import * as pgCols from '@prisma-next/adapter-postgres/column-types';
import * as sqliteCols from '@prisma-next/adapter-sqlite/column-types';
import sqlFamilyPack from '@prisma-next/family-sql/pack';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import { sql } from '@prisma-next/sql-builder/runtime';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import postgresPack from '@prisma-next/target-postgres/pack';
import sqlitePack from '@prisma-next/target-sqlite/pack';
import { expectTypeOf, test } from 'vitest';

/**
 * Spike: prove the no-emit type-inference path works for the kind of
 * inline contracts our migration tests build. Mirrors
 * `test/integration/test/dsl-type-inference.test-d.ts` but uses the
 * column-type primitives we'd reach for in migration tests, and
 * exercises both sqlite and postgres packs to make sure both flow
 * through the type machinery.
 *
 * Goal: confirm that `validateContract<typeof contract>(...)` plus
 * `sql({ context })` gives us a `db` with literal-typed table names
 * and column shapes — without an emitted `.d.ts`.
 */

// ---------------------------------------------------------------------------
// SQLite — origin and destination contracts (mirrors a "drop column" migration)
// ---------------------------------------------------------------------------

const sqliteOrigin = defineContract({
  family: sqlFamilyPack,
  target: sqlitePack,
  models: {
    User: model('User', {
      fields: {
        id: field.column(sqliteCols.integerColumn).id(),
        name: field.column(sqliteCols.textColumn),
        temp: field.column(sqliteCols.textColumn).optional(),
      },
    }),
  },
});

const sqliteDestination = defineContract({
  family: sqlFamilyPack,
  target: sqlitePack,
  models: {
    User: model('User', {
      fields: {
        id: field.column(sqliteCols.integerColumn).id(),
        name: field.column(sqliteCols.textColumn),
      },
    }),
  },
});

test('sqlite: model name literals survive on origin contract', () => {
  expectTypeOf<keyof typeof sqliteOrigin.models>().toEqualTypeOf<'User'>();
});

test('sqlite: origin User has temp column, destination User does not', () => {
  type OriginUserCols = (typeof sqliteOrigin.storage.tables)['User']['columns'];
  type DestUserCols = (typeof sqliteDestination.storage.tables)['User']['columns'];
  expectTypeOf<keyof OriginUserCols>().toEqualTypeOf<'id' | 'name' | 'temp'>();
  expectTypeOf<keyof DestUserCols>().toEqualTypeOf<'id' | 'name'>();
});

// Note: `createTestContext` from sql-runtime's test utils is hardcoded to a
// postgres test target descriptor, so we only construct a runtime `db` for
// postgres contracts below. Sqlite contracts here are type-only — that's
// enough to prove the literal type machinery flows from `defineContract`.
test('sqlite: storage.tables column shapes are typed end to end', () => {
  type OriginUserCols = (typeof sqliteOrigin.storage.tables)['User']['columns'];
  expectTypeOf<keyof OriginUserCols>().toEqualTypeOf<'id' | 'name' | 'temp'>();
  type DestUserCols = (typeof sqliteDestination.storage.tables)['User']['columns'];
  expectTypeOf<keyof DestUserCols>().toEqualTypeOf<'id' | 'name'>();
});

// ---------------------------------------------------------------------------
// Postgres — same shape, same typing guarantees with a different pack
// ---------------------------------------------------------------------------

const postgresOrigin = defineContract({
  family: sqlFamilyPack,
  target: postgresPack,
  models: {
    User: model('User', {
      fields: {
        id: field.column(pgCols.int4Column).id(),
        name: field.column(pgCols.textColumn),
        temp: field.column(pgCols.textColumn).optional(),
      },
    }),
  },
});

const postgresDestination = defineContract({
  family: sqlFamilyPack,
  target: postgresPack,
  models: {
    User: model('User', {
      fields: {
        id: field.column(pgCols.int4Column).id(),
        name: field.column(pgCols.textColumn),
      },
    }),
  },
});

test('postgres: db.User typed against destination rejects dropped column', () => {
  const validated = validateContract<typeof postgresDestination>(
    postgresDestination,
    emptyCodecLookup,
  );
  const context = createTestContext(validated, createStubAdapter());
  const db = sql({ context });
  // Negative type check — never invoked at runtime so the DSL's column
  // guard doesn't fire. `void` keeps the compiler from flagging the lambda
  // as unused.
  void (() => {
    // @ts-expect-error - "temp" was dropped in destination, must not appear in select.
    db.User.select('id', 'name', 'temp');
  });
});

test('postgres: origin and destination both produce typed db surfaces', () => {
  const validatedOrigin = validateContract<typeof postgresOrigin>(postgresOrigin, emptyCodecLookup);
  const validatedDest = validateContract<typeof postgresDestination>(
    postgresDestination,
    emptyCodecLookup,
  );
  const ctxOrigin = createTestContext(validatedOrigin, createStubAdapter());
  const ctxDest = createTestContext(validatedDest, createStubAdapter());
  const dbOrigin = sql({ context: ctxOrigin });
  const dbDest = sql({ context: ctxDest });
  // Both surfaces have `User`, but with different column sets.
  dbOrigin.User.select('id', 'name', 'temp').build();
  dbDest.User.select('id', 'name').build();
});

// ---------------------------------------------------------------------------
// Sanity: `defineContract` returns inferred types when called inside a function
// (the way migration tests build contracts inside `it()` callbacks).
// ---------------------------------------------------------------------------

test('contracts built inside a function still preserve literal types', () => {
  function buildContract() {
    return defineContract({
      family: sqlFamilyPack,
      target: sqlitePack,
      models: {
        Account: model('Account', {
          fields: {
            id: field.column(sqliteCols.integerColumn).id(),
            email: field.column(sqliteCols.textColumn).unique(),
          },
        }),
      },
    });
  }

  const contract = buildContract();
  expectTypeOf<keyof typeof contract.models>().toEqualTypeOf<'Account'>();
  type AccountCols = (typeof contract.storage.tables)['Account']['columns'];
  expectTypeOf<keyof AccountCols>().toEqualTypeOf<'id' | 'email'>();
});
