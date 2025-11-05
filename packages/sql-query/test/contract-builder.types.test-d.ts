import { expectTypeOf, test } from 'vitest';
import { defineContract } from '../src/contract-builder';
import { validateContract } from '../src/contract';
import { schema } from '../src/schema';
import { sql } from '../src/sql';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import type { ResultType, Plan } from '../src/types';
import type { Contract, CodecTypes } from './fixtures/contract.d';
import { dataTypes } from '../../adapter-postgres/src/exports/codec-types';

test('builder contract types match fixture contract types', () => {
  const builderContract = defineContract<CodecTypes>()
    .target('postgres')
    .table('user', (t) =>
      t
        .column('id', 'int4', { nullable: false })
        .column('email', 'text', { nullable: false })
        .column('createdAt', 'timestamptz', { nullable: false })
        .primaryKey(['id']),
    )
    .model('User', 'user', (m) =>
      m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
    )
    .coreHash('sha256:test-core')
    .build();

  const validatedBuilderContract = validateContract<typeof builderContract>(builderContract);
  const fixtureContract = validateContract<Contract>(
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('./fixtures/contract.json'),
  );

  type BuilderUserTable = NonNullable<typeof validatedBuilderContract.storage.tables['user']>;
  type FixtureUserTable = NonNullable<typeof fixtureContract.storage.tables['user']>;

  expectTypeOf<BuilderUserTable>().toHaveProperty('columns');
  expectTypeOf<FixtureUserTable>().toHaveProperty('columns');
});

test('ResultType inference works identically to fixture contract', () => {
  const builderContract = defineContract<CodecTypes>()
    .target('postgres')
    .table('user', (t) =>
      t
        .column('id', 'int4', { nullable: false })
        .column('email', 'text', { nullable: false })
        .column('createdAt', 'timestamptz', { nullable: false })
        .primaryKey(['id']),
    )
    .model('User', 'user', (m) =>
      m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
    )
    .coreHash('sha256:test-core')
    .build();

  const validatedBuilderContract = validateContract<typeof builderContract>(builderContract);
  const adapter = createPostgresAdapter();
  const tables = schema<typeof validatedBuilderContract, CodecTypes>(validatedBuilderContract).tables;
  const userTable = tables['user'];
  if (!userTable) throw new Error('user table not found');

  const plan = sql<typeof validatedBuilderContract, CodecTypes>({
    contract: validatedBuilderContract,
    adapter,
  })
    .from(userTable)
    .select({
      id: userTable.columns['id']!,
      email: userTable.columns['email']!,
      createdAt: userTable.columns['createdAt']!,
    })
    .build();

  type BuilderRow = ResultType<typeof plan>;

  const fixtureContract = validateContract<Contract>(
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('./fixtures/contract.json'),
  );
  const fixtureTables = schema<Contract, CodecTypes>(fixtureContract).tables;
  const fixtureUserTable = fixtureTables['user'];
  if (!fixtureUserTable) throw new Error('fixture user table not found');
  const fixturePlan = sql<Contract, CodecTypes>({ contract: fixtureContract, adapter })
    .from(fixtureUserTable)
    .select({
      id: fixtureUserTable.columns['id']!,
      email: fixtureUserTable.columns['email']!,
      createdAt: fixtureUserTable.columns['createdAt']!,
    })
    .build();

  type FixtureRow = ResultType<typeof fixturePlan>;

  expectTypeOf<BuilderRow>().toHaveProperty('id');
  expectTypeOf<BuilderRow>().toHaveProperty('email');
  expectTypeOf<BuilderRow>().toHaveProperty('createdAt');
  expectTypeOf<FixtureRow>().toHaveProperty('id');
  expectTypeOf<FixtureRow>().toHaveProperty('email');
  expectTypeOf<FixtureRow>().toHaveProperty('createdAt');
  expectTypeOf(plan).toExtend<Plan<BuilderRow>>();
});

test('codec type inference via type option', () => {
  const contract = defineContract<CodecTypes>()
    .target('postgres')
    .table('user', (t) =>
      t
        .column('id', 'int4', { nullable: false, type: dataTypes.int4 })
        .column('email', 'text', { nullable: false, type: dataTypes.text })
        .column('createdAt', 'timestamptz', { nullable: false, type: dataTypes.timestamptz }),
    )
    .model('User', 'user', (m) =>
      m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
    )
    .build();

  const validated = validateContract<typeof contract>(contract);
  const adapter = createPostgresAdapter();
  const tables = schema<typeof validated, CodecTypes>(validated).tables;
  const userTable = tables['user'];
  if (!userTable) throw new Error('user table not found');

  const plan = sql<typeof validated, CodecTypes>({ contract: validated, adapter })
    .from(userTable)
    .select({
      id: userTable.columns['id']!,
      email: userTable.columns['email']!,
      createdAt: userTable.columns['createdAt']!,
    })
    .build();

  type Row = ResultType<typeof plan>;

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
        .column('id', 'int4', { nullable: false })
        .column('email', 'text', { nullable: false }),
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

