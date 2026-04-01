import type { JsonValue } from '@prisma-next/adapter-postgres/codec-types';
import {
  int4Column,
  jsonb,
  textColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import type { ExtensionPackRef } from '@prisma-next/contract/framework-components';
import { sql } from '@prisma-next/sql-builder/runtime';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { defineContract, field, model, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import postgresPack from '@prisma-next/target-postgres/pack';
import { type as arktype } from 'arktype';
import { expectTypeOf, test } from 'vitest';
import type { CodecTypes, Contract } from './fixtures/contract.d';
import contractJson from './fixtures/contract.json' with { type: 'json' };

const typecheckOnly = process.env['PN_TYPECHECK_ONLY'] === 'true';

const pgvectorPack = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  authoring: {
    type: {
      pgvector: {
        vector: {
          kind: 'typeConstructor',
          args: [{ kind: 'number', integer: true, minimum: 1, maximum: 2000 }],
          output: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: {
              length: { kind: 'arg', index: 0 },
            },
          },
        },
      },
    },
  },
} as const satisfies ExtensionPackRef<'sql', 'postgres'>;

test('builder contract types match fixture contract types', () => {
  const builderContract = defineContract<CodecTypes>()
    .target(postgresPack)
    .table('user', (t) =>
      t
        .column('id', { type: int4Column, nullable: false })
        .column('email', { type: textColumn, nullable: false })
        .column('createdAt', { type: timestamptzColumn, nullable: false })
        .primaryKey(['id']),
    )
    .model('User', 'user', (m) =>
      m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
    )
    .storageHash('sha256:test-core')
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
    .target(postgresPack)
    .table('user', (t) =>
      t
        .column('id', { type: int4Column, nullable: false })
        .column('email', { type: textColumn, nullable: false })
        .column('createdAt', { type: timestamptzColumn, nullable: false })
        .primaryKey(['id']),
    )
    .model('User', 'user', (m) =>
      m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
    )
    .storageHash('sha256:test-core')
    .build();

  const validatedBuilderContract = validateContract<typeof builderContract>(builderContract);
  const adapter = createStubAdapter();
  const context = createTestContext(validatedBuilderContract, adapter);
  const tables = schema(context).tables;
  const userTable = tables['user'];
  if (!userTable) throw new Error('user table not found');

  const db = sql({ context });
  const _plan = db.user.select('id', 'email', 'createdAt').build();

  type BuilderRow = ResultType<typeof _plan>;

  const _fixtureContract = validateContract<Contract>(contractJson);
  const fixtureContext = createTestContext(_fixtureContract, adapter);
  const fixtureTables = schema(fixtureContext).tables;
  const fixtureUserTable = fixtureTables['user'];
  if (!fixtureUserTable) throw new Error('fixture user table not found');
  const fixtureDb = sql({ context: fixtureContext });
  const _fixturePlan = fixtureDb.user.select('id', 'email', 'createdAt').build();

  type FixtureRow = ResultType<typeof _fixturePlan>;

  expectTypeOf<BuilderRow>().toHaveProperty('id');
  expectTypeOf<BuilderRow>().toHaveProperty('email');
  expectTypeOf<BuilderRow>().toHaveProperty('createdAt');
  expectTypeOf<FixtureRow>().toHaveProperty('id');
  expectTypeOf<FixtureRow>().toHaveProperty('email');
  expectTypeOf<FixtureRow>().toHaveProperty('createdAt');
  expectTypeOf(_plan).toExtend<SqlQueryPlan<BuilderRow>>();
});

test('refined object contract preserves downstream schema and model token inference', () => {
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
    target: postgresPack,
    storageHash: 'sha256:test-refined',
    models: {
      User,
      Post,
    },
  });

  const validated = validateContract<typeof contract>(contract);
  const adapter = createStubAdapter();
  const context = createTestContext(validated, adapter);
  const tables = schema(context).tables;
  const userTable = tables['user'];
  if (!userTable) throw new Error('user table not found');
  type RefinedUserColumns = NonNullable<
    NonNullable<(typeof validated.storage.tables)['user']>['columns']
  >;

  expectTypeOf<typeof validated.storage.tables>().toExtend<Record<string, unknown>>();
  expectTypeOf<RefinedUserColumns>().toExtend<Record<string, { readonly codecId: string }>>();
  expectTypeOf(validated.models.User.storage.table).toExtend<string>();
  expectTypeOf<
    NonNullable<(typeof validated.models.Post.fields)['userId']>['column']
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
      target: postgresPack,
      extensionPacks: {
        pgvector: pgvectorPack,
      },
    },
    ({ type, field, model }) => {
      const Role = type.enum('role', ['USER', 'ADMIN'] as const);
      const Embedding = type.pgvector.vector(1536);

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
              id: field.id.uuidv7(),
              role: field.namedType(Role),
              embedding: field.namedType(Embedding).optional(),
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
  expectTypeOf(contract.storage.tables.user.columns.role.typeRef).toEqualTypeOf<'Role'>();
  expectTypeOf(contract.storage.tables.user.columns.embedding.typeRef).toEqualTypeOf<'Embedding'>();
});

test('integrated callback authoring hides extension namespaces when packs are absent', () => {
  defineContract(
    {
      target: postgresPack,
    },
    ({ type }) => {
      type.enum('role', ['USER'] as const);

      if (typecheckOnly) {
        // @ts-expect-error extension-owned helper requires the corresponding pack
        type.pgvector.vector(1536);
      }

      return {
        models: {},
      };
    },
  );
});

test('local field and belongsTo sql overlays stay typed', () => {
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
});

test('explicit generated id helpers stay typed', () => {
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
});

test('portable refined helpers preserve downstream schema inference', () => {
  const UserBase = model('User', {
    fields: {
      id: field.id.uuidv7(),
      email: field.text(),
      createdAt: field.createdAt(),
    },
  });

  const Post = model('Post', {
    fields: {
      id: field.id.uuidv7(),
      authorId: field.uuid(),
      title: field.text(),
    },
    relations: {
      user: rel.belongsTo(UserBase, { from: 'authorId', to: 'id' }),
    },
  }).sql(({ cols, constraints }) => ({
    table: 'post',
    foreignKeys: [constraints.foreignKey(cols.authorId, UserBase.refs.id)],
  }));

  const User = UserBase.relations({
    posts: rel.hasMany(() => Post, { by: 'authorId' }),
  }).sql({
    table: 'user',
  });

  const contract = defineContract({
    target: postgresPack,
    storageHash: 'sha256:test-refined-helpers',
    models: {
      User,
      Post,
    },
  });

  const validated = validateContract<typeof contract>(contract);
  const adapter = createStubAdapter();
  const context = createTestContext(validated, adapter);
  const tables = schema(context).tables;
  const userTable = tables['user'];
  if (!userTable) throw new Error('user table not found');
  type PortableUserColumns = NonNullable<
    NonNullable<(typeof validated.storage.tables)['user']>['columns']
  >;
  type PortablePostColumns = NonNullable<
    NonNullable<(typeof validated.storage.tables)['post']>['columns']
  >;

  expectTypeOf<PortableUserColumns>().toExtend<Record<string, { readonly codecId: string }>>();
  expectTypeOf<PortablePostColumns>().toExtend<Record<string, { readonly codecId: string }>>();
});

test('codec type inference via type option', () => {
  const contract = defineContract<CodecTypes>()
    .target(postgresPack)
    .table('user', (t) =>
      t
        .column('id', { type: int4Column, nullable: false })
        .column('email', { type: textColumn, nullable: false })
        .column('createdAt', { type: timestamptzColumn, nullable: false })
        .primaryKey(['id']),
    )
    .model('User', 'user', (m) =>
      m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
    )
    .build();

  const validated = validateContract<typeof contract>(contract);
  const adapter = createStubAdapter();
  const context = createTestContext(validated, adapter);
  const tables = schema(context).tables;
  const userTable = tables['user'];
  if (!userTable) throw new Error('user table not found');

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

test('contract structure type matches SqlContract', () => {
  const contract = defineContract<CodecTypes>()
    .target(postgresPack)
    .table('user', (t) =>
      t
        .column('id', { type: int4Column, nullable: false })
        .column('email', { type: textColumn, nullable: false }),
    )
    .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
    .build();

  expectTypeOf(contract).toHaveProperty('schemaVersion');
  expectTypeOf(contract).toHaveProperty('target');
  expectTypeOf(contract).toHaveProperty('targetFamily');
  expectTypeOf(contract).toHaveProperty('storageHash');
  expectTypeOf(contract).toHaveProperty('models');
  expectTypeOf(contract).toHaveProperty('storage');
  expectTypeOf(contract).toHaveProperty('mappings');
});

test('jsonb schema preserves JsonValue fallback in no-emit type path', () => {
  const payloadSchema = arktype({
    action: 'string',
    actorId: 'number',
  });

  const contract = defineContract<CodecTypes>()
    .target(postgresPack)
    .table('event', (t) =>
      t
        .column('id', { type: int4Column, nullable: false })
        .column('payload', { type: jsonb(payloadSchema), nullable: false })
        .column('meta', { type: jsonb(), nullable: false })
        .primaryKey(['id']),
    )
    .model('Event', 'event', (m) =>
      m.field('id', 'id').field('payload', 'payload').field('meta', 'meta'),
    )
    .build();

  const validated = validateContract<typeof contract>(contract);
  const context = createTestContext(validated, createStubAdapter());
  const table = schema(context).tables['event'];
  if (!table) throw new Error('event table not found');

  const db = sql({ context });
  const _plan = db.event.select('payload', 'meta').build();

  type Row = ResultType<typeof _plan>;

  expectTypeOf<Row['payload']>().toEqualTypeOf<unknown>();
  expectTypeOf<Row['meta']>().toEqualTypeOf<unknown>();
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
