import type { TargetPackRef } from '@prisma-next/contract/framework-components';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  defineContract,
  field,
  model,
  rel,
  type StagedContractInput,
  type StagedModelBuilder,
} from '../src/contract-builder';
import type {
  ModelAttributesSpec,
  RelationBuilder,
  RelationState,
  ScalarFieldBuilder,
  SqlStageSpec,
} from '../src/staged-contract-dsl';

type AnyModel = StagedModelBuilder<
  string | undefined,
  Record<string, ScalarFieldBuilder>,
  Record<string, RelationBuilder<RelationState>>,
  ModelAttributesSpec | undefined,
  SqlStageSpec | undefined
>;

import { columnDescriptor } from './helpers/column-descriptor';

const typecheckOnly = process.env['PN_TYPECHECK_ONLY'] === 'true';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

const int4Column = columnDescriptor('pg/int4@1');
const textColumn = columnDescriptor('pg/text@1');
const timestamptzColumn = columnDescriptor('pg/timestamptz@1');

function defineStagedContract<const Definition extends Omit<StagedContractInput, 'target'>>(
  definition: Definition,
) {
  return defineContract({
    target: postgresTargetPack,
    ...definition,
  });
}

type OwnershipRelationCase = {
  readonly label: 'hasMany' | 'hasOne';
  readonly relationName: 'posts' | 'profile';
  readonly targetModelName: 'Post' | 'Profile';
  readonly targetTable: 'blog_post' | 'user_profile';
  readonly expectedCardinality: '1:N' | '1:1';
};

function buildOwnershipRelationContract(ownershipCase: OwnershipRelationCase) {
  const User: AnyModel = model('User', {
    fields: {
      id: field.column(textColumn).id(),
      ...(ownershipCase.label === 'hasMany' ? { email: field.column(textColumn) } : {}),
    },
  });

  const Target = model(ownershipCase.targetModelName, {
    fields: {
      id: field.column(textColumn).id(),
      userId: field.column(textColumn).column('user_id'),
      ...(ownershipCase.label === 'hasMany' ? { title: field.column(textColumn) } : {}),
    },
  });

  return defineStagedContract({
    models: {
      User: User.relations({
        [ownershipCase.relationName]:
          ownershipCase.label === 'hasMany'
            ? rel.hasMany(Target, { by: 'userId' })
            : rel.hasOne(() => Target, { by: 'userId' }),
      }).sql({
        table: 'app_user',
      }),
      [ownershipCase.targetModelName]: Target.relations({
        user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
      }).sql(({ cols, constraints }) => ({
        table: ownershipCase.targetTable,
        foreignKeys: [constraints.foreignKey([cols.userId], [User.refs['id']!])],
      })),
    },
  });
}

describe('staged contract DSL authoring surface', () => {
  it('lowers inline ids and uniques while keeping sql focused on table/index/fk concerns', () => {
    const types = {
      Role: {
        codecId: 'pg/enum@1',
        nativeType: 'role',
        typeParams: { values: ['USER', 'ADMIN'] },
      },
    } as const;

    const User: AnyModel = model('User', {
      fields: {
        id: field
          .generated({
            type: textColumn,
            generated: { kind: 'generator', id: 'uuidv4' },
          })
          .id({ name: 'app_user_pkey' }),
        email: field.column(textColumn).unique({ name: 'app_user_email_key' }),
        role: field.namedType(types.Role),
        createdAt: field.column(timestamptzColumn).column('created_at').defaultSql('now()'),
      },
      relations: {
        posts: rel.hasMany(() => Post, { by: 'userId' }),
      },
    }).sql({
      table: 'app_user',
    });

    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id({ name: 'blog_post_pkey' }),
        userId: field.column(textColumn).column('user_id'),
        title: field.column(textColumn),
      },
      relations: {
        user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'blog_post',
      indexes: [constraints.index(cols.userId, { name: 'blog_post_user_id_idx' })],
      foreignKeys: [
        constraints.foreignKey([cols.userId], [User.refs['id']!], {
          name: 'blog_post_user_id_fkey',
          onDelete: 'cascade',
        }),
      ],
    }));

    const contract = defineStagedContract({
      storageHash: 'sha256:staged-contract-dsl',
      foreignKeyDefaults: { constraint: true, index: false },
      types,
      models: {
        User,
        Post,
      },
    });
    const storageTables = contract.storage.tables as Record<
      string,
      {
        readonly primaryKey?: unknown;
        readonly uniques?: unknown;
        readonly indexes?: unknown;
        readonly foreignKeys?: unknown;
        readonly columns: Record<
          string,
          { readonly default?: unknown; readonly typeRef?: unknown }
        >;
      }
    >;

    expect(contract.target).toBe('postgres');
    expect(contract.storageHash).toBe('sha256:staged-contract-dsl');
    expect(storageTables['app_user']).toMatchObject({
      primaryKey: { columns: ['id'], name: 'app_user_pkey' },
      uniques: [{ columns: ['email'], name: 'app_user_email_key' }],
    });
    expect(storageTables['blog_post']).toMatchObject({
      primaryKey: { columns: ['id'], name: 'blog_post_pkey' },
      indexes: [{ columns: ['user_id'], name: 'blog_post_user_id_idx' }],
    });

    const appUserColumns = storageTables['app_user']?.columns;
    expect(appUserColumns?.['created_at']?.default).toEqual({
      kind: 'function',
      expression: 'now()',
    });
    expect(appUserColumns?.['role']?.typeRef).toBe('Role');
    expect(storageTables['blog_post']?.foreignKeys).toEqual([
      {
        columns: ['user_id'],
        references: { table: 'app_user', columns: ['id'] },
        name: 'blog_post_user_id_fkey',
        onDelete: 'cascade',
        constraint: true,
        index: false,
      },
    ]);
    expect(contract.execution?.mutations.defaults).toEqual([
      {
        ref: { table: 'app_user', column: 'id' },
        onCreate: { kind: 'generator', id: 'uuidv4' },
      },
    ]);
    const contractModels = contract.models as Record<string, { fields: Record<string, unknown> }>;
    expect(contractModels['User']?.fields['createdAt']).toEqual({ column: 'created_at' });
    expect(contractModels['Post']?.fields['userId']).toEqual({ column: 'user_id' });
    expect(contract.relations['app_user']).toMatchObject({
      posts: {
        to: 'Post',
        cardinality: '1:N',
        on: {
          parentCols: ['id'],
          childCols: ['user_id'],
        },
      },
    });
    expect(contract.relations['blog_post']).toMatchObject({
      user: {
        to: 'User',
        cardinality: 'N:1',
        on: {
          parentCols: ['user_id'],
          childCols: ['id'],
        },
      },
    });
  });

  it('keeps field and belongsTo storage overrides local when possible', () => {
    const User = model('User', {
      fields: {
        id: field
          .column(textColumn)
          .id()
          .sql({ id: { name: 'app_user_pkey' } }),
        email: field
          .column(textColumn)
          .unique()
          .sql({ unique: { name: 'app_user_email_key' } }),
      },
    }).sql({
      table: 'app_user',
    });

    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id({ name: 'blog_post_pkey' }),
        authorId: field.column(textColumn).sql({ column: 'author_id' }),
        createdAt: field.column(timestamptzColumn).sql({ column: 'created_at' }),
      },
      relations: {
        author: rel
          .belongsTo(User, { from: 'authorId', to: 'id' })
          .sql({ fk: { name: 'blog_post_author_id_fkey', onDelete: 'cascade' } }),
      },
    }).sql({
      table: 'blog_post',
    });

    const contract = defineStagedContract({
      foreignKeyDefaults: { constraint: true, index: false },
      models: {
        User,
        Post,
      },
    });

    const tables = contract.storage.tables as Record<
      string,
      {
        primaryKey?: unknown;
        uniques?: unknown;
        foreignKeys?: unknown;
        columns: Record<string, unknown>;
      }
    >;
    const models = contract.models as Record<string, { fields: Record<string, unknown> }>;
    expect(tables['app_user']?.primaryKey).toEqual({
      columns: ['id'],
      name: 'app_user_pkey',
    });
    expect(tables['app_user']?.uniques).toEqual([
      {
        columns: ['email'],
        name: 'app_user_email_key',
      },
    ]);
    expect(tables['blog_post']?.columns['author_id']).toBeDefined();
    expect(tables['blog_post']?.columns['created_at']).toBeDefined();
    expect(tables['blog_post']?.foreignKeys).toEqual([
      {
        columns: ['author_id'],
        references: { table: 'app_user', columns: ['id'] },
        name: 'blog_post_author_id_fkey',
        onDelete: 'cascade',
        constraint: true,
        index: false,
      },
    ]);
    expect(models['Post']?.fields['authorId']).toEqual({ column: 'author_id' });
    expect(models['Post']?.fields['createdAt']).toEqual({ column: 'created_at' });
  });

  it.each([
    [
      'unique',
      () =>
        field.column(textColumn).sql({
          unique: { name: 'user_email_key' },
        }),
      /field\.sql\(\{ unique \}\) requires an existing inline \.unique/,
    ],
    [
      'id',
      () =>
        field.column(textColumn).sql({
          id: { name: 'user_pkey' },
        }),
      /field\.sql\(\{ id \}\) requires an existing inline \.id/,
    ],
  ] as const)('rejects field-local %s overlays without the semantic declaration', (_label, run, error) => {
    expect(run).toThrow(error);
  });

  it('supports token-based many-to-many relations with lazy through refs', () => {
    const PostTag = model('PostTag', {
      fields: {
        postId: field.column(textColumn).column('post_id'),
        tagId: field.column(textColumn).column('tag_id'),
      },
    }).sql({
      table: 'post_tag',
    });

    const Post: AnyModel = model('Post', {
      fields: {
        id: field.column(textColumn).id(),
        title: field.column(textColumn),
      },
      relations: {
        tags: rel.manyToMany(() => Tag, {
          through: () => PostTag,
          from: 'postId',
          to: 'tagId',
        }),
      },
    }).sql({
      table: 'post',
    });

    const Tag = model('Tag', {
      fields: {
        id: field.column(textColumn).id(),
        label: field.column(textColumn),
      },
      relations: {
        posts: rel.manyToMany(Post, {
          through: () => PostTag,
          from: 'tagId',
          to: 'postId',
        }),
      },
    }).sql({
      table: 'tag',
    });

    const contract = defineStagedContract({
      models: {
        Post,
        Tag,
        PostTag,
      },
    });

    expect(contract.relations['post']).toMatchObject({
      tags: {
        to: 'Tag',
        cardinality: 'N:M',
        through: {
          table: 'post_tag',
          parentCols: ['post_id'],
          childCols: ['tag_id'],
        },
      },
    });
    expect(contract.relations['tag']).toMatchObject({
      posts: {
        to: 'Post',
        cardinality: 'N:M',
        through: {
          table: 'post_tag',
          parentCols: ['tag_id'],
          childCols: ['post_id'],
        },
      },
    });
  });

  it('rejects duplicate named storage objects in the refined sql overlay', () => {
    const User = model('User', {
      fields: {
        id: field.column(textColumn).id({ name: 'app_user_pkey' }),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'app_user',
      indexes: [constraints.index(cols.id, { name: 'app_user_pkey' })],
    }));

    expect(() =>
      defineStagedContract({
        models: {
          User,
        },
      }),
    ).toThrow(/Contract semantic validation failed:.*app_user_pkey/);
  });

  it('supports compound ids and uniques in .attributes(...)', () => {
    const Membership = model('Membership', {
      fields: {
        orgId: field.column(textColumn).column('org_id'),
        userId: field.column(textColumn).column('user_id'),
        role: field.column(textColumn),
      },
    })
      .attributes(({ fields, constraints }) => ({
        id: constraints.id([fields.orgId, fields.userId], {
          name: 'membership_pkey',
        }),
        uniques: [
          constraints.unique([fields.orgId, fields.role], {
            name: 'membership_org_role_key',
          }),
        ],
      }))
      .sql({
        table: 'membership',
      });

    const contract = defineStagedContract({
      models: {
        Membership,
      },
    });

    expect((contract.storage.tables as Record<string, unknown>)['membership']).toMatchObject({
      primaryKey: {
        columns: ['org_id', 'user_id'],
        name: 'membership_pkey',
      },
      uniques: [
        {
          columns: ['org_id', 'role'],
          name: 'membership_org_role_key',
        },
      ],
    });
  });

  it.each([
    {
      label: 'hasMany',
      relationName: 'posts',
      targetModelName: 'Post',
      targetTable: 'blog_post',
      expectedCardinality: '1:N',
    },
    {
      label: 'hasOne',
      relationName: 'profile',
      targetModelName: 'Profile',
      targetTable: 'user_profile',
      expectedCardinality: '1:1',
    },
  ] as const)('lowers %s ownership relations through the staged relation pipeline', ({
    relationName,
    targetModelName,
    targetTable,
    expectedCardinality,
    ...ownershipCase
  }) => {
    const contract = buildOwnershipRelationContract({
      relationName,
      targetModelName,
      targetTable,
      expectedCardinality,
      ...ownershipCase,
    });

    expect(contract.relations['app_user']).toMatchObject({
      [relationName]: {
        to: targetModelName,
        cardinality: expectedCardinality,
        on: {
          parentCols: ['id'],
          childCols: ['user_id'],
        },
      },
    });
    expect(contract.relations[targetTable]).toMatchObject({
      user: {
        to: 'User',
        cardinality: 'N:1',
        on: {
          parentCols: ['user_id'],
          childCols: ['id'],
        },
      },
    });
  });

  it('applies root naming defaults and preserves explicit overrides', () => {
    const BlogPost = model('BlogPost', {
      fields: {
        id: field.column(int4Column).id(),
        createdAt: field.column(timestamptzColumn),
        authorId: field.column(textColumn).column('author_identifier'),
      },
    }).sql(({ cols, constraints }) => ({
      indexes: [constraints.index(cols.authorId, { name: 'blog_post_author_identifier_idx' })],
    }));

    const contract = defineStagedContract({
      naming: { tables: 'snake_case', columns: 'snake_case' },
      models: {
        BlogPost,
      },
    });

    const tables = contract.storage.tables as Record<string, { columns: Record<string, unknown> }>;
    expect(tables['blog_post']).toBeDefined();
    expect(tables['blog_post']?.columns['created_at']).toBeDefined();
    expect(tables['blog_post']?.columns['author_identifier']).toBeDefined();
    const models = contract.models as Record<string, { fields: Record<string, unknown> }>;
    expect(models['BlogPost']?.fields['createdAt']).toEqual({ column: 'created_at' });
    expect(models['BlogPost']?.fields['authorId']).toEqual({
      column: 'author_identifier',
    });
  });

  it.each([
    {
      name: 'table names',
      run: () => {
        const BlogPost = model('BlogPost', {
          fields: {
            id: field.column(int4Column).id(),
          },
        });

        const blogPost = model('blogPost', {
          fields: {
            id: field.column(int4Column).id(),
          },
        });

        return defineStagedContract({
          naming: { tables: 'snake_case' },
          models: {
            BlogPost,
            blogPost,
          },
        });
      },
      error: /Models "BlogPost" and "blogPost" both map to table "blog_post"/,
    },
    {
      name: 'column names',
      run: () => {
        const BlogPost = model('BlogPost', {
          fields: {
            id: field.column(int4Column).id(),
            createdAt: field.column(timestamptzColumn),
            created_at: field.column(timestamptzColumn),
          },
        });

        return defineStagedContract({
          naming: { columns: 'snake_case' },
          models: {
            BlogPost,
          },
        });
      },
      error: /Model "BlogPost" maps both "createdAt" and "created_at" to column "created_at"/,
    },
  ])('rejects duplicate %s after applying naming defaults', ({ run, error }) => {
    expect(run).toThrow(error);
  });

  it('rejects duplicate relation names when mixing model relations with staged .relations()', () => {
    const User = model('User', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(int4Column),
      },
      relations: {
        user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
      },
    });

    expect(() =>
      Post.relations({
        user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
      }),
    ).toThrow('Model "Post" already defines relation "user".');
  });

  it('rejects belongsTo relations whose field arity does not match the target', () => {
    const User = model('User', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    const Membership = model('Membership', {
      fields: {
        id: field.column(int4Column).id(),
        orgId: field.column(int4Column),
        userId: field.column(int4Column),
      },
      relations: {
        user: rel.belongsTo(User, { from: ['orgId', 'userId'], to: 'id' }),
      },
    });

    expect(() =>
      defineStagedContract({
        models: {
          User,
          Membership,
        },
      }),
    ).toThrow('Relation "Membership.user" maps 2 source field(s) to 1 target field(s).');
  });

  it('rejects hasMany relations whose child fields do not match the parent identity arity', () => {
    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id(),
        authorId: field.column(int4Column),
      },
    });

    const User = model('User', {
      fields: {
        orgId: field.column(int4Column),
        id: field.column(int4Column),
      },
      relations: {
        posts: rel.hasMany(Post, { by: 'authorId' }),
      },
    }).attributes(({ fields, constraints }) => ({
      id: constraints.id([fields.orgId, fields.id]),
    }));

    expect(() =>
      defineStagedContract({
        models: {
          User,
          Post,
        },
      }),
    ).toThrow('Relation "User.posts" maps 2 anchor field(s) to 1 child field(s).');
  });

  it('rejects many-to-many relations whose through mappings do not match anchor arity', () => {
    const PostTag = model('PostTag', {
      fields: {
        postId: field.column(int4Column),
        postTenantId: field.column(int4Column),
        tagId: field.column(int4Column),
      },
    });

    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id(),
      },
      relations: {
        tags: rel.manyToMany(() => Tag, {
          through: () => PostTag,
          from: ['postId', 'postTenantId'],
          to: 'tagId',
        }),
      },
    });

    const Tag = model('Tag', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    expect(() =>
      defineStagedContract({
        models: {
          Post,
          Tag,
          PostTag,
        },
      }),
    ).toThrow('Relation "Post.tags" has mismatched many-to-many field counts.');
  });

  it('types local refs and named model tokens separately', () => {
    const Post = model('Post', {
      fields: {
        id: field.column(int4Column),
        userId: field.column(int4Column),
        title: field.column(textColumn),
      },
    });

    const User = model('User', {
      fields: {
        id: field.column(int4Column),
        email: field.column(textColumn),
      },
      relations: {
        posts: rel.hasMany(Post, { by: 'userId' }),
      },
    })
      .attributes(({ fields, constraints }) => {
        expectTypeOf(fields.id.fieldName).toEqualTypeOf<'id'>();
        expectTypeOf(fields.email.fieldName).toEqualTypeOf<'email'>();

        // @ts-expect-error relation fields must not appear in attributes field refs
        fields.posts;

        return {
          id: constraints.id(fields.id),
        };
      })
      .sql(({ cols, constraints }) => {
        expectTypeOf(cols.id.fieldName).toEqualTypeOf<'id'>();
        expectTypeOf(cols.email.fieldName).toEqualTypeOf<'email'>();
        expectTypeOf(User.refs['id']!.fieldName).toEqualTypeOf<'id'>();
        expectTypeOf(User.refs['id']!.modelName).toEqualTypeOf<'User'>();
        expectTypeOf(User.ref('email').fieldName).toEqualTypeOf<'email'>();
        expectTypeOf(User.ref('email').modelName).toEqualTypeOf<'User'>();

        // @ts-expect-error relation fields must not appear in sql column refs
        cols.posts;

        // @ts-expect-error relation fields must not appear in model token refs
        User.refs.posts;

        // @ts-expect-error unknown field names must not appear in model token refs
        User.ref('posts');

        return {
          indexes: [constraints.index(cols.email)],
        };
      });

    if (typecheckOnly) {
      rel.belongsTo(User, { from: 'userId', to: 'id' });
      rel.hasMany(Post, { by: 'userId' });

      // @ts-expect-error relation targets must expose real scalar fields
      rel.belongsTo(User, { from: 'userId', to: 'posts' });

      // @ts-expect-error relation targets must expose real scalar fields
      rel.hasMany(Post, { by: 'posts' });
    }

    expect(User).toBeDefined();
  });

  it('requires a named model token before cross-model refs are available', () => {
    const Anonymous = model({
      fields: {
        id: field.column(int4Column),
      },
    });

    if (typecheckOnly) {
      // @ts-expect-error unnamed models must not expose token-based cross-model refs
      Anonymous.ref('id');

      // @ts-expect-error unnamed models must not expose token-based cross-model refs
      Anonymous.refs.id;

      // @ts-expect-error unnamed models must not compile as relation targets
      rel.belongsTo(Anonymous, { from: 'id', to: 'id' });

      // @ts-expect-error unnamed models must not compile through lazy relation targets
      rel.hasMany(() => Anonymous, { by: 'id' });
    }

    expect(Anonymous).toBeDefined();
  });

  it('rejects mismatched model token keys during lowering', () => {
    const User = model('User', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    expect(() =>
      defineStagedContract({
        models: {
          Account: User,
        },
      }),
    ).toThrow('Model token "User" must be assigned to models.User. Received models.Account.');
  });
});
