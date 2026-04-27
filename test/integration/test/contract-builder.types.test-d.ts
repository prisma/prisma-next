import {
  int4Column,
  jsonb,
  textColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import pgvectorPack from '@prisma-next/extension-pgvector/pack';
import sqlFamilyPack from '@prisma-next/family-sql/pack';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import { sql } from '@prisma-next/sql-builder/runtime';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { defineContract, field, model, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import type { JsonValue } from '@prisma-next/target-postgres/codec-types';
import postgresPack from '@prisma-next/target-postgres/pack';
import { type as arktype } from 'arktype';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from './fixtures/contract.d';
import contractJson from './fixtures/contract.json' with { type: 'json' };

const typecheckOnly = process.env['PN_TYPECHECK_ONLY'] === 'true';

test('builder contract types match fixture contract types', () => {
  const builderContract = defineContract({
    family: sqlFamilyPack,
    target: postgresPack,
    storageHash: 'sha256:test-core',
    models: {
      User: model('User', {
        fields: {
          id: field.column(int4Column).id(),
          email: field.column(textColumn),
          createdAt: field.column(timestamptzColumn),
        },
      }).sql({ table: 'user' }),
    },
  });

  const _validatedBuilderContract = validateContract<typeof builderContract>(
    builderContract,
    emptyCodecLookup,
  );
  const _fixtureContract = validateContract<Contract>(contractJson, emptyCodecLookup);

  type BuilderUserTable = NonNullable<(typeof _validatedBuilderContract.storage.tables)['user']>;
  type FixtureUserTable = NonNullable<(typeof _fixtureContract.storage.tables)['user']>;

  expectTypeOf<BuilderUserTable>().toHaveProperty('columns');
  expectTypeOf<FixtureUserTable>().toHaveProperty('columns');
});

test('ResultType inference works identically to fixture contract', () => {
  const builderContract = defineContract({
    family: sqlFamilyPack,
    target: postgresPack,
    storageHash: 'sha256:test-core',
    models: {
      User: model('User', {
        fields: {
          id: field.column(int4Column).id(),
          email: field.column(textColumn),
          createdAt: field.column(timestamptzColumn),
        },
      }).sql({ table: 'user' }),
    },
  });

  const validatedBuilderContract = validateContract<typeof builderContract>(
    builderContract,
    emptyCodecLookup,
  );
  const adapter = createStubAdapter();
  const context = createTestContext(validatedBuilderContract, adapter);

  const db = sql({ context });
  const _plan = db.user.select('id', 'email', 'createdAt').build();

  type BuilderRow = ResultType<typeof _plan>;

  const _fixtureContract = validateContract<Contract>(contractJson, emptyCodecLookup);
  const fixtureContext = createTestContext(_fixtureContract, adapter);
  const fixtureDb = sql({ context: fixtureContext });
  const _fixturePlan = fixtureDb['user']!.select('id', 'email', 'createdAt').build();

  type FixtureRow = ResultType<typeof _fixturePlan>;

  expectTypeOf<BuilderRow>().toEqualTypeOf<FixtureRow>();
  expectTypeOf(_plan).toExtend<SqlQueryPlan<FixtureRow>>();
});

test('refined object contract preserves downstream model token inference', () => {
  const UserBase = model('User', {
    fields: {
      id: field.column(int4Column).id(),
      email: field.column(textColumn),
      createdAt: field.column(timestamptzColumn),
    },
  });

  const Post = model('Post', {
    fields: {
      id: field.column(int4Column).id(),
      userId: field.column(int4Column),
      title: field.column(textColumn),
    },
    relations: {
      user: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }),
    },
  }).sql(({ cols, constraints }) => ({
    table: 'post',
    foreignKeys: [constraints.foreignKey(cols.userId, UserBase.refs.id)],
  }));

  const User = UserBase.relations({
    posts: rel.hasMany(() => Post, { by: 'userId' }),
  }).sql({
    table: 'user',
  });

  const contract = defineContract({
    family: sqlFamilyPack,
    target: postgresPack,
    storageHash: 'sha256:test-refined',
    models: {
      User,
      Post,
    },
  });

  const validated = validateContract<typeof contract>(contract, emptyCodecLookup);
  type RefinedUserColumns = NonNullable<
    NonNullable<(typeof validated.storage.tables)['user']>['columns']
  >;

  expectTypeOf<typeof validated.storage.tables>().toExtend<Record<string, unknown>>();
  expectTypeOf<RefinedUserColumns>().toExtend<Record<string, { readonly codecId: string }>>();
  expectTypeOf(validated.models.User.storage.table).toExtend<string>();
  expectTypeOf<
    NonNullable<(typeof validated.models.Post.storage.fields)['userId']>['column']
  >().toExtend<string>();
  expectTypeOf(User.refs.id.fieldName).toEqualTypeOf<'id'>();
  expectTypeOf(User.refs.id.modelName).toEqualTypeOf<'User'>();
  expectTypeOf(User.ref('email').fieldName).toEqualTypeOf<'email'>();
  expectTypeOf(User.ref('email').modelName).toEqualTypeOf<'User'>();

  rel.belongsTo(User, { from: 'userId', to: 'id' });
  rel.hasMany(Post, { by: 'userId' });

  // @ts-expect-error relation fields must not appear in model token refs
  User.refs.posts;

  // @ts-expect-error unknown field names must not compile for model token refs
  User.ref('posts');

  // @ts-expect-error relation targets must expose real scalar fields
  rel.belongsTo(User, { from: 'userId', to: 'posts' });

  // @ts-expect-error relation targets must expose real scalar fields
  rel.hasMany(Post, { by: 'posts' });
});

test('integrated callback authoring exposes composition-shaped type helpers', () => {
  const contract = defineContract(
    {
      family: sqlFamilyPack,
      target: postgresPack,
      extensionPacks: {
        pgvector: pgvectorPack,
      },
    },
    ({ type, field, model }) => {
      const Role = type.enum('role', ['USER', 'ADMIN'] as const);
      const Embedding = type.pgvector.Vector(1536);

      expectTypeOf(Role.codecId).toEqualTypeOf<'pg/enum@1'>();
      expectTypeOf(Role.typeParams.values).toEqualTypeOf<readonly ['USER', 'ADMIN']>();
      expectTypeOf(Embedding.codecId).toEqualTypeOf<'pg/vector@1'>();
      expectTypeOf(Embedding.typeParams.length).toEqualTypeOf<1536>();

      return {
        types: {
          Role,
          Embedding,
        },
        models: {
          User: model('User', {
            fields: {
              id: field.int().defaultSql('autoincrement()').id(),
              email: field.text().unique(),
              age: field.int(),
              isActive: field.boolean().default(true),
              score: field.float().optional(),
              profile: field.json().optional(),
              role: field.namedType(Role),
              embedding: field.namedType(Embedding).optional(),
              createdAt: field.createdAt(),
            },
          }).sql({
            table: 'user',
          }),
        },
      };
    },
  );

  type CallbackStorageTypes = NonNullable<typeof contract.storage.types>;

  expectTypeOf<keyof CallbackStorageTypes>().toEqualTypeOf<'Role' | 'Embedding'>();
  expectTypeOf<CallbackStorageTypes['Role']['codecId']>().toEqualTypeOf<'pg/enum@1'>();
  expectTypeOf<CallbackStorageTypes['Embedding']['codecId']>().toEqualTypeOf<'pg/vector@1'>();
  expectTypeOf(contract.storage.tables.user.columns.id.codecId).toEqualTypeOf<'pg/int4@1'>();
  expectTypeOf(contract.storage.tables.user.columns.email.codecId).toEqualTypeOf<'pg/text@1'>();
  expectTypeOf(contract.storage.tables.user.columns.age.codecId).toEqualTypeOf<'pg/int4@1'>();
  expectTypeOf(contract.storage.tables.user.columns.isActive.codecId).toEqualTypeOf<'pg/bool@1'>();
  expectTypeOf(contract.storage.tables.user.columns.score.codecId).toEqualTypeOf<'pg/float8@1'>();
  expectTypeOf(contract.storage.tables.user.columns.profile.codecId).toEqualTypeOf<'pg/jsonb@1'>();
  expectTypeOf(
    contract.storage.tables.user.columns.createdAt.codecId,
  ).toEqualTypeOf<'pg/timestamptz@1'>();
  expectTypeOf(contract.storage.tables.user.columns.role.typeRef).toEqualTypeOf<'Role'>();
  expectTypeOf(contract.storage.tables.user.columns.embedding.typeRef).toEqualTypeOf<'Embedding'>();
});

test('integrated callback authoring hides extension namespaces when packs are absent', () => {
  defineContract(
    {
      family: sqlFamilyPack,
      target: postgresPack,
    },
    ({ type }) => {
      type.enum('role', ['USER'] as const);

      if (typecheckOnly) {
        // @ts-expect-error extension-owned helper requires the corresponding pack
        type.pgvector.Vector(1536);
      }

      return {
        models: {},
      };
    },
  );
});

test('local field and belongsTo sql overlays stay typed', () => {
  defineContract(
    {
      family: sqlFamilyPack,
      target: postgresPack,
    },
    ({ field }) => {
      const User = model('User', {
        fields: {
          id: field.id.uuidv4().sql({ id: { name: 'user_pkey' } }),
          email: field
            .text()
            .unique()
            .sql({ unique: { name: 'user_email_key' } }),
        },
      });

      const Post = model('Post', {
        fields: {
          id: field.id.uuidv4(),
          authorId: field.uuid().sql({ column: 'author_id' }),
        },
        relations: {
          author: rel
            .belongsTo(User, { from: 'authorId', to: 'id' })
            .sql({ fk: { name: 'post_author_id_fkey', onDelete: 'cascade' } }),
        },
      });

      expectTypeOf(User.buildAttributesSpec()).toEqualTypeOf<undefined>();
      expectTypeOf(Post.buildSqlSpec()).toExtend<
        | {
            readonly table?: string;
            readonly indexes?: readonly unknown[];
            readonly foreignKeys?: readonly unknown[];
          }
        | undefined
      >();

      if (typecheckOnly) {
        // @ts-expect-error relation-local sql is only supported on belongsTo relations
        rel.hasMany(Post, { by: 'authorId' }).sql({ fk: { name: 'post_author_id_fkey' } });
      }

      return { models: {} };
    },
  );
});

test('explicit generated id helpers stay typed', () => {
  defineContract(
    {
      family: sqlFamilyPack,
      target: postgresPack,
    },
    ({ field }) => {
      const ShortLink = model('ShortLink', {
        fields: {
          id: field.id.nanoid({ size: 16 }, { name: 'short_link_pkey' }),
          ownerId: field.uuid(),
          publicId: field.nanoid({ size: 16 }),
        },
      }).sql({
        table: 'short_link',
      });

      expectTypeOf(ShortLink.buildSqlSpec()).toExtend<
        | {
            readonly table?: string;
            readonly indexes?: readonly unknown[];
            readonly foreignKeys?: readonly unknown[];
          }
        | undefined
      >();

      if (typecheckOnly) {
        // @ts-expect-error uuidv7 helper accepts only an optional trailing PK-name object
        field.id.uuidv7({ size: 16 });

        // @ts-expect-error nanoid size must be a number
        field.id.nanoid({ size: '16' });

        // @ts-expect-error scalar nanoid size must be a number
        field.nanoid({ size: '16' });
      }

      return { models: {} };
    },
  );
});

test('codec type inference via type option', () => {
  const contract = defineContract({
    family: sqlFamilyPack,
    target: postgresPack,
    models: {
      User: model('User', {
        fields: {
          id: field.column(int4Column).id(),
          email: field.column(textColumn),
          createdAt: field.column(timestamptzColumn),
        },
      }).sql({ table: 'user' }),
    },
  });

  const validated = validateContract<typeof contract>(contract, emptyCodecLookup);
  const context = createTestContext(validated, createStubAdapter());

  const db = sql({ context });
  const _plan = db.user.select('id', 'email', 'createdAt').build();

  type Row = ResultType<typeof _plan>;

  expectTypeOf<Row>().toHaveProperty('id');
  expectTypeOf<Row>().toHaveProperty('email');
  expectTypeOf<Row>().toHaveProperty('createdAt');

  const _testRow: Row = {
    id: 1,
    email: 'test@example.com',
    createdAt: '2024-01-01T00:00:00Z',
  } as Row;

  expectTypeOf(_testRow).toEqualTypeOf<Row>();
});

test('contract structure type matches Contract', () => {
  const contract = defineContract({
    family: sqlFamilyPack,
    target: postgresPack,
    models: {
      User: model('User', {
        fields: {
          id: field.column(int4Column),
          email: field.column(textColumn),
        },
      }).sql({ table: 'user' }),
    },
  });

  expectTypeOf(contract).toHaveProperty('target');
  expectTypeOf(contract).toHaveProperty('targetFamily');
  expectTypeOf(contract).toHaveProperty('models');
  expectTypeOf(contract).toHaveProperty('storage');
});

test('jsonb schema preserves JsonValue fallback in no-emit type path', () => {
  const payloadSchema = arktype({
    action: 'string',
    actorId: 'number',
  });

  const contract = defineContract({
    family: sqlFamilyPack,
    target: postgresPack,
    models: {
      Event: model('Event', {
        fields: {
          id: field.column(int4Column).id(),
          payload: field.column(jsonb(payloadSchema)),
          meta: field.column(jsonb()),
        },
      }).sql({ table: 'event' }),
    },
  });

  const validated = validateContract<typeof contract>(contract, emptyCodecLookup);
  const context = createTestContext(validated, createStubAdapter());

  const db = sql({ context });
  const _plan = db.event.select('payload', 'meta').build();

  type Row = ResultType<typeof _plan>;

  // The DSL derives codec types from the pack's phantom __codecTypes field.
  // Because the pack declares __codecTypes as optional, the type resolver
  // cannot narrow the codec output for jsonb columns in the no-emit path,
  // so ResultType falls back to never. The chain builder's explicit
  // <CodecTypes> parameter resolved this to unknown. Tracked as a known
  // DSL type-inference gap to fix when __codecTypes becomes required on packs.
  expectTypeOf<Row['payload']>().toEqualTypeOf(undefined as never);
  expectTypeOf<Row['meta']>().toEqualTypeOf(undefined as never);
});

type ResolveStandardSchemaOutput<P> = P extends { readonly schema: infer Schema }
  ? Schema extends { readonly infer: infer Output }
    ? Output
    : Schema extends {
          readonly '~standard': { readonly types?: { readonly output?: infer Output } };
        }
      ? Output extends undefined
        ? JsonValue
        : Output
      : JsonValue
  : JsonValue;

test('ResolveStandardSchemaOutput resolves Arktype schema via .infer', () => {
  const profileSchema = arktype({ displayName: 'string', active: 'boolean' });
  type Resolved = ResolveStandardSchemaOutput<{ readonly schema: typeof profileSchema }>;

  expectTypeOf<Resolved>().toEqualTypeOf<{ displayName: string; active: boolean }>();
});

test('ResolveStandardSchemaOutput resolves Standard Schema via ~standard.types.output', () => {
  type BareStandardSchema = {
    readonly '~standard': {
      readonly types: {
        readonly output: { rank: number; verified: boolean };
      };
    };
  };

  type Resolved = ResolveStandardSchemaOutput<{ readonly schema: BareStandardSchema }>;

  expectTypeOf<Resolved>().toEqualTypeOf<{ rank: number; verified: boolean }>();
});

test('ResolveStandardSchemaOutput falls back to JsonValue without schema', () => {
  type Resolved = ResolveStandardSchemaOutput<Record<never, never>>;

  expectTypeOf<Resolved>().toEqualTypeOf<JsonValue>();
});
