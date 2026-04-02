import type { ExtensionPackRef, TargetPackRef } from '@prisma-next/contract/framework-components';
import { describe, expect, it } from 'vitest';
import {
  defineContract,
  field,
  model,
  rel,
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

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

const pgvectorPack: ExtensionPackRef<'sql', 'postgres'> = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

const int4Column = columnDescriptor('pg/int4@1');
const textColumn = columnDescriptor('pg/text@1');
const timestamptzColumn = columnDescriptor('pg/timestamptz@1');

function expectStagedParity(refined: unknown, legacy: unknown): void {
  expect(refined).toEqual(legacy);
}

describe('staged contract DSL parity with legacy builder', () => {
  it('matches legacy builder output for named types, defaults, naming defaults, and foreign keys', () => {
    const types = {
      Role: {
        codecId: 'pg/enum@1',
        nativeType: 'role',
        typeParams: { values: ['USER', 'ADMIN'] },
      },
    } as const;

    const BlogUser = model('BlogUser', {
      fields: {
        id: field
          .generated({
            type: textColumn,
            generated: { kind: 'generator', id: 'uuidv4' },
          })
          .id({ name: 'blog_user_pkey' }),
        email: field.column(textColumn).unique({ name: 'blog_user_email_key' }),
        createdAt: field.column(timestamptzColumn).defaultSql('now()'),
        role: field.namedType(types.Role),
      },
    });

    const BlogPost = model('BlogPost', {
      fields: {
        id: field.column(int4Column).id({ name: 'blog_post_pkey' }),
        authorId: field.column(textColumn),
        title: field.column(textColumn),
      },
    });

    const refined = defineContract({
      target: postgresTargetPack,
      extensionPacks: { pgvector: pgvectorPack },
      naming: { tables: 'snake_case', columns: 'snake_case' },
      storageHash: 'sha256:staged-contract-dsl-parity-core',
      foreignKeyDefaults: { constraint: true, index: false },
      capabilities: {
        postgres: {
          lateral: true,
          returning: true,
        },
      },
      types,
      models: {
        BlogUser: BlogUser.relations({
          posts: rel.hasMany(BlogPost, { by: 'authorId' }),
        }).sql({}),
        BlogPost: BlogPost.relations({
          author: rel.belongsTo(BlogUser, { from: 'authorId', to: 'id' }),
        }).sql(({ cols, constraints }) => ({
          indexes: [constraints.index(cols.authorId, { name: 'blog_post_author_id_idx' })],
          foreignKeys: [
            constraints.foreignKey(cols.authorId, BlogUser.refs.id, {
              name: 'blog_post_author_id_fkey',
              onDelete: 'cascade',
            }),
          ],
        })),
      },
    });

    const roleColumn = {
      codecId: 'pg/enum@1',
      nativeType: 'role',
      typeRef: 'Role',
    } as const;

    const legacy = defineContract()
      .target(postgresTargetPack)
      .extensionPacks({ pgvector: pgvectorPack })
      .storageHash('sha256:staged-contract-dsl-parity-core')
      .foreignKeyDefaults({ constraint: true, index: false })
      .capabilities({
        postgres: {
          lateral: true,
          returning: true,
        },
      })
      .storageType('Role', {
        codecId: 'pg/enum@1',
        nativeType: 'role',
        typeParams: { values: ['USER', 'ADMIN'] },
      })
      .table('blog_user', (t) =>
        t
          .generated('id', {
            type: textColumn,
            generated: { kind: 'generator', id: 'uuidv4' },
          })
          .column('email', { type: textColumn })
          .column('created_at', {
            type: timestamptzColumn,
            default: { kind: 'function', expression: 'now()' },
          })
          .column('role', { type: roleColumn })
          .primaryKey(['id'], 'blog_user_pkey')
          .unique(['email'], 'blog_user_email_key'),
      )
      .table('blog_post', (t) =>
        t
          .column('id', { type: int4Column })
          .column('author_id', { type: textColumn })
          .column('title', { type: textColumn })
          .primaryKey(['id'], 'blog_post_pkey')
          .index(['author_id'], 'blog_post_author_id_idx')
          .foreignKey(
            ['author_id'],
            { table: 'blog_user', columns: ['id'] },
            {
              name: 'blog_post_author_id_fkey',
              onDelete: 'cascade',
            },
          ),
      )
      .model('BlogUser', 'blog_user', (m) =>
        m
          .field('id', 'id')
          .field('email', 'email')
          .field('createdAt', 'created_at')
          .field('role', 'role')
          .relation('posts', {
            toModel: 'BlogPost',
            toTable: 'blog_post',
            cardinality: '1:N',
            on: {
              parentTable: 'blog_user',
              parentColumns: ['id'],
              childTable: 'blog_post',
              childColumns: ['author_id'],
            },
          }),
      )
      .model('BlogPost', 'blog_post', (m) =>
        m
          .field('id', 'id')
          .field('authorId', 'author_id')
          .field('title', 'title')
          .relation('author', {
            toModel: 'BlogUser',
            toTable: 'blog_user',
            cardinality: 'N:1',
            on: {
              parentTable: 'blog_post',
              parentColumns: ['author_id'],
              childTable: 'blog_user',
              childColumns: ['id'],
            },
          }),
      )
      .build();

    expectStagedParity(refined, legacy);
  });

  it('matches legacy builder output for compound ids and uniques', () => {
    const Membership = model('Membership', {
      fields: {
        orgId: field.column(textColumn),
        userId: field.column(textColumn),
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
      .sql({});

    const refined = defineContract({
      target: postgresTargetPack,
      naming: { tables: 'snake_case', columns: 'snake_case' },
      models: {
        Membership,
      },
    });

    const legacy = defineContract()
      .target(postgresTargetPack)
      .table('membership', (t) =>
        t
          .column('org_id', { type: textColumn })
          .column('user_id', { type: textColumn })
          .column('role', { type: textColumn })
          .primaryKey(['org_id', 'user_id'], 'membership_pkey')
          .unique(['org_id', 'role'], 'membership_org_role_key'),
      )
      .model('Membership', 'membership', (m) =>
        m.field('orgId', 'org_id').field('userId', 'user_id').field('role', 'role'),
      )
      .build();

    expectStagedParity(refined, legacy);
  });

  it('matches legacy builder output for many-to-many relation lowering', () => {
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

    const refined = defineContract({
      target: postgresTargetPack,
      models: {
        Post,
        Tag,
        PostTag,
      },
    });

    const legacy = defineContract()
      .target(postgresTargetPack)
      .table('post', (t) =>
        t
          .column('id', { type: textColumn })
          .column('title', { type: textColumn })
          .primaryKey(['id']),
      )
      .table('tag', (t) =>
        t
          .column('id', { type: textColumn })
          .column('label', { type: textColumn })
          .primaryKey(['id']),
      )
      .table('post_tag', (t) =>
        t.column('post_id', { type: textColumn }).column('tag_id', { type: textColumn }),
      )
      .model('Post', 'post', (m) =>
        m
          .field('id', 'id')
          .field('title', 'title')
          .relation('tags', {
            toModel: 'Tag',
            toTable: 'tag',
            cardinality: 'N:M',
            through: {
              table: 'post_tag',
              parentColumns: ['post_id'],
              childColumns: ['tag_id'],
            },
            on: {
              parentTable: 'post',
              parentColumns: ['id'],
              childTable: 'post_tag',
              childColumns: ['post_id'],
            },
          }),
      )
      .model('Tag', 'tag', (m) =>
        m
          .field('id', 'id')
          .field('label', 'label')
          .relation('posts', {
            toModel: 'Post',
            toTable: 'post',
            cardinality: 'N:M',
            through: {
              table: 'post_tag',
              parentColumns: ['tag_id'],
              childColumns: ['post_id'],
            },
            on: {
              parentTable: 'tag',
              parentColumns: ['id'],
              childTable: 'post_tag',
              childColumns: ['tag_id'],
            },
          }),
      )
      .model('PostTag', 'post_tag', (m) => m.field('postId', 'post_id').field('tagId', 'tag_id'))
      .build();

    expectStagedParity(refined, legacy);
  });
});
