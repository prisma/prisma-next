import type { TargetPackRef } from '@prisma-next/contract/framework-components';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineContract, field, model, rel } from '../src/contract-builder';
import { columnDescriptor } from './helpers/column-descriptor';

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

describe('refined option A authoring surface', () => {
  it('lowers inline ids and uniques while keeping sql focused on table/index/fk concerns', () => {
    const User = model('User', {
      fields: {
        id: field
          .generated({
            type: textColumn,
            generated: { kind: 'generator', id: 'uuidv4' },
          })
          .id({ name: 'app_user_pkey' }),
        email: field.column(textColumn).unique({ name: 'app_user_email_key' }),
        role: field.namedType('Role'),
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
        constraints.foreignKey(cols.userId, User.refs.id, {
          name: 'blog_post_user_id_fkey',
          onDelete: 'cascade',
        }),
      ],
    }));

    const contract = defineContract({
      target: postgresTargetPack,
      storageHash: 'sha256:refined-option-a',
      foreignKeyDefaults: { constraint: true, index: false },
      types: {
        Role: {
          codecId: 'pg/enum@1',
          nativeType: 'role',
          typeParams: { values: ['USER', 'ADMIN'] },
        },
      },
      models: {
        User,
        Post,
      },
    });

    expect(contract.target).toBe('postgres');
    expect(contract.storageHash).toBe('sha256:refined-option-a');
    expect(contract.storage.tables['app_user']).toMatchObject({
      primaryKey: { columns: ['id'], name: 'app_user_pkey' },
      uniques: [{ columns: ['email'], name: 'app_user_email_key' }],
    });
    expect(contract.storage.tables['blog_post']).toMatchObject({
      primaryKey: { columns: ['id'], name: 'blog_post_pkey' },
      indexes: [{ columns: ['user_id'], name: 'blog_post_user_id_idx' }],
    });

    const appUserColumns = contract.storage.tables['app_user']?.columns as
      | Record<string, { default?: unknown; typeRef?: unknown }>
      | undefined;
    expect(appUserColumns?.['created_at']?.default).toEqual({
      kind: 'function',
      expression: 'now()',
    });
    expect(appUserColumns?.['role']?.typeRef).toBe('Role');
    expect(contract.storage.tables['blog_post']?.foreignKeys).toEqual([
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
    expect(contract.models['User']?.fields['createdAt']).toEqual({ column: 'created_at' });
    expect(contract.models['Post']?.fields['userId']).toEqual({ column: 'user_id' });
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

  it('supports token-based many-to-many relations with lazy through refs', () => {
    const PostTag = model('PostTag', {
      fields: {
        postId: field.column(textColumn).column('post_id'),
        tagId: field.column(textColumn).column('tag_id'),
      },
    }).sql({
      table: 'post_tag',
    });

    const Tag = model('Tag', {
      fields: {
        id: field.column(textColumn).id(),
        label: field.column(textColumn),
      },
      relations: {
        posts: rel.manyToMany(() => Post, {
          through: () => PostTag,
          from: 'tagId',
          to: 'postId',
        }),
      },
    }).sql({
      table: 'tag',
    });

    const Post = model('Post', {
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

    const contract = defineContract({
      target: postgresTargetPack,
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

    const contract = defineContract({
      target: postgresTargetPack,
      models: {
        Membership,
      },
    });

    expect(contract.storage.tables.membership).toMatchObject({
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

  it('supports staged .relations(...) for mutually recursive models', () => {
    const User = model('User', {
      fields: {
        id: field.column(textColumn).id(),
        email: field.column(textColumn),
      },
    });

    const Post = model('Post', {
      fields: {
        id: field.column(textColumn).id(),
        userId: field.column(textColumn).column('user_id'),
        title: field.column(textColumn),
      },
    });

    const contract = defineContract({
      target: postgresTargetPack,
      models: {
        User: User.relations({
          posts: rel.hasMany(Post, { by: 'userId' }),
        }).sql({
          table: 'app_user',
        }),
        Post: Post.relations({
          user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
        }).sql(({ cols, constraints }) => ({
          table: 'blog_post',
          foreignKeys: [constraints.foreignKey(cols.userId, User.refs.id)],
        })),
      },
    });

    expect(contract.relations['app_user']).toMatchObject({
      posts: {
        to: 'Post',
        cardinality: '1:N',
      },
    });
    expect(contract.relations['blog_post']).toMatchObject({
      user: {
        to: 'User',
        cardinality: 'N:1',
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

    const contract = defineContract({
      target: postgresTargetPack,
      naming: { tables: 'snake_case', columns: 'snake_case' },
      models: {
        BlogPost,
      },
    });

    expect(contract.storage.tables['blog_post']).toBeDefined();
    expect(contract.storage.tables['blog_post']?.columns['created_at']).toBeDefined();
    expect(contract.storage.tables['blog_post']?.columns['author_identifier']).toBeDefined();
    expect(contract.models['BlogPost']?.fields['createdAt']).toEqual({ column: 'created_at' });
    expect(contract.models['BlogPost']?.fields['authorId']).toEqual({
      column: 'author_identifier',
    });
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
        expectTypeOf(User.refs.id.fieldName).toEqualTypeOf<'id'>();
        expectTypeOf(User.refs.id.modelName).toEqualTypeOf<'User'>();
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

    if (false) {
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

    if (false) {
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
      defineContract({
        target: postgresTargetPack,
        models: {
          Account: User,
        },
      }),
    ).toThrow('Model token "User" must be assigned to models.User. Received models.Account.');
  });
});
