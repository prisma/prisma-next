import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { dataTypes } from '@prisma-next/adapter-postgres/codec-types';
import type { Plan, ResultType } from '@prisma-next/contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import { schema } from '@prisma-next/sql-query/schema';
import { sql } from '@prisma-next/sql-query/sql';
import { createRuntimeContext } from '@prisma-next/sql-runtime';
import { expectTypeOf, test } from 'vitest';
import type { CodecTypes, Contract } from './fixtures/contract.d';
import contractJson from './fixtures/contract.json' with { type: 'json' };

test('builder contract types match fixture contract types', () => {
  const builderContract = defineContract<CodecTypes>()
    .target('postgres')
    .table('user', (t) =>
      t
        .column('id', { type: 'pg/int4@1', nullable: false })
        .column('email', { type: 'pg/text@1', nullable: false })
        .column('createdAt', { type: 'pg/timestamptz@1', nullable: false })
        .primaryKey(['id']),
    )
    .model('User', 'user', (m) =>
      m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
    )
    .coreHash('sha256:test-core')
    .build();

  const _validatedBuilderContract = validateContract<typeof builderContract>(builderContract);
  const _fixtureContract = validateContract<Contract>(contractJson);

  type BuilderUserTable = NonNullable<(typeof _validatedBuilderContract.storage.tables)['user']>;
  type FixtureUserTable = NonNullable<(typeof _fixtureContract.storage.tables)['user']>;

  expectTypeOf<BuilderUserTable>().toHaveProperty('columns');
  expectTypeOf<FixtureUserTable>().toHaveProperty('columns');
});

test('ResultType inference works identically to fixture contract', () => {
  const builderContract = defineContract<CodecTypes>()
    .target('postgres')
    .table('user', (t) =>
      t
        .column('id', { type: 'pg/int4@1', nullable: false })
        .column('email', { type: 'pg/text@1', nullable: false })
        .column('createdAt', { type: 'pg/timestamptz@1', nullable: false })
        .primaryKey(['id']),
    )
    .model('User', 'user', (m) =>
      m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
    )
    .coreHash('sha256:test-core')
    .build();

  const validatedBuilderContract = validateContract<typeof builderContract>(builderContract);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({
    contract: validatedBuilderContract,
    adapter,
    extensions: [],
  });
  const tables = schema(context).tables;
  const userTable = tables['user'];
  if (!userTable) throw new Error('user table not found');

  const _plan = sql({ context })
    .from(userTable)
    .select({
      id: userTable.columns['id']!,
      email: userTable.columns['email']!,
      createdAt: userTable.columns['createdAt']!,
    })
    .build();

  type BuilderRow = ResultType<typeof _plan>;

  const _fixtureContract = validateContract<Contract>(contractJson);
  const fixtureContext = createRuntimeContext({
    contract: _fixtureContract,
    adapter,
    extensions: [],
  });
  const fixtureTables = schema(fixtureContext).tables;
  const fixtureUserTable = fixtureTables.user;
  if (!fixtureUserTable) throw new Error('fixture user table not found');
  const _fixturePlan = sql({ context: fixtureContext })
    .from(fixtureUserTable)
    .select({
      id: fixtureUserTable.columns.id!,
      email: fixtureUserTable.columns.email!,
      createdAt: fixtureUserTable.columns.createdAt!,
    })
    .build();

  type FixtureRow = ResultType<typeof _fixturePlan>;

  expectTypeOf<BuilderRow>().toHaveProperty('id');
  expectTypeOf<BuilderRow>().toHaveProperty('email');
  expectTypeOf<BuilderRow>().toHaveProperty('createdAt');
  expectTypeOf<FixtureRow>().toHaveProperty('id');
  expectTypeOf<FixtureRow>().toHaveProperty('email');
  expectTypeOf<FixtureRow>().toHaveProperty('createdAt');
  expectTypeOf(_plan).toExtend<Plan<BuilderRow>>();
});

test('codec type inference via type option', () => {
  const contract = defineContract<CodecTypes>()
    .target('postgres')
    .table('user', (t) =>
      t
        .column('id', { type: dataTypes.int4, nullable: false })
        .column('email', { type: dataTypes.text, nullable: false })
        .column('createdAt', { type: dataTypes.timestamptz, nullable: false })
        .primaryKey(['id']),
    )
    .model('User', 'user', (m) =>
      m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
    )
    .build();

  const validated = validateContract<typeof contract>(contract);
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract: validated, adapter, extensions: [] });
  const tables = schema(context).tables;
  const userTable = tables['user'];
  if (!userTable) throw new Error('user table not found');

  const _plan = sql({ context })
    .from(userTable)
    .select({
      id: userTable.columns['id']!,
      email: userTable.columns['email']!,
      createdAt: userTable.columns['createdAt']!,
    })
    .build();

  type Row = ResultType<typeof _plan>;

  expectTypeOf<Row>().toHaveProperty('id');
  expectTypeOf<Row>().toHaveProperty('email');
  expectTypeOf<Row>().toHaveProperty('createdAt');

  const _testRow: Row = {
    id: 1,
    email: 'test@example.com',
    createdAt: '2024-01-01T00:00:00Z',
  } as Row;

  expectTypeOf(_testRow).toMatchTypeOf<Row>();
});

test('contract structure type matches SqlContract', () => {
  const contract = defineContract<CodecTypes>()
    .target('postgres')
    .table('user', (t) =>
      t
        .column('id', { type: 'pg/int4@1', nullable: false })
        .column('email', { type: 'pg/text@1', nullable: false }),
    )
    .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
    .build();

  expectTypeOf(contract).toHaveProperty('schemaVersion');
  expectTypeOf(contract).toHaveProperty('target');
  expectTypeOf(contract).toHaveProperty('targetFamily');
  expectTypeOf(contract).toHaveProperty('coreHash');
  expectTypeOf(contract).toHaveProperty('models');
  expectTypeOf(contract).toHaveProperty('storage');
  expectTypeOf(contract).toHaveProperty('mappings');
});
