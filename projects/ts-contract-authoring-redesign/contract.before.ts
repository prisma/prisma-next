import {
  enumColumn,
  enumType,
  textColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import { vector } from '@prisma-next/extension-pgvector/column-types';
import pgvector from '@prisma-next/extension-pgvector/pack';
import { uuidv4 } from '@prisma-next/ids';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const uuidColumn = {
  codecId: 'sql/char@1',
  nativeType: 'character',
  typeParams: { length: 36 },
} as const;

const embeddingColumn = {
  ...vector(1536),
  typeRef: 'Embedding1536',
} as const;

export const contract = defineContract()
  .target(postgresPack)
  .extensionPacks({ pgvector })
  .storageHash('sha256:ts-contract-authoring-redesign-demo')
  .foreignKeyDefaults({ constraint: true, index: false })
  .capabilities({
    postgres: {
      lateral: true,
      jsonAgg: true,
      returning: true,
      'pgvector/cosine': true,
      'defaults.now': true,
    },
  })
  .storageType('user_type', enumType('user_type', ['admin', 'user']))
  .storageType('post_status', enumType('post_status', ['draft', 'published', 'archived']))
  .storageType('Embedding1536', vector(1536))
  .table('user', (t) =>
    t
      .generated('id', uuidv4())
      .column('email', { type: textColumn, nullable: false })
      .column('created_at', {
        type: timestamptzColumn,
        nullable: false,
        default: { kind: 'function', expression: 'now()' },
      })
      .column('kind', {
        type: enumColumn('user_type', 'user_type'),
        nullable: false,
      })
      .primaryKey(['id'], 'user_pkey')
      .unique(['email'], 'user_email_key'),
  )
  .table('profile', (t) =>
    t
      .generated('id', uuidv4())
      .column('user_id', { type: uuidColumn, nullable: false })
      .column('bio', { type: textColumn, nullable: true })
      .column('embedding', { type: embeddingColumn, nullable: true })
      .column('created_at', {
        type: timestamptzColumn,
        nullable: false,
        default: { kind: 'function', expression: 'now()' },
      })
      .primaryKey(['id'], 'profile_pkey')
      .unique(['user_id'], 'profile_user_id_key')
      .foreignKey(
        ['user_id'],
        { table: 'user', columns: ['id'] },
        {
          name: 'profile_user_id_fkey',
          onDelete: 'cascade',
        },
      ),
  )
  .table('post', (t) =>
    t
      .generated('id', uuidv4())
      .column('author_id', { type: uuidColumn, nullable: false })
      .column('title', { type: textColumn, nullable: false })
      .column('status', {
        type: enumColumn('post_status', 'post_status'),
        nullable: false,
      })
      .column('search_embedding', { type: embeddingColumn, nullable: true })
      .column('created_at', {
        type: timestamptzColumn,
        nullable: false,
        default: { kind: 'function', expression: 'now()' },
      })
      .primaryKey(['id'], 'post_pkey')
      .unique(['author_id', 'title'], 'post_author_id_title_key')
      .index(['author_id'], 'post_author_id_idx')
      .foreignKey(
        ['author_id'],
        { table: 'user', columns: ['id'] },
        {
          name: 'post_author_id_fkey',
          onDelete: 'cascade',
        },
      ),
  )
  .table('tag', (t) =>
    t
      .generated('id', uuidv4())
      .column('slug', { type: textColumn, nullable: false })
      .column('label', { type: textColumn, nullable: false })
      .column('created_at', {
        type: timestamptzColumn,
        nullable: false,
        default: { kind: 'function', expression: 'now()' },
      })
      .primaryKey(['id'], 'tag_pkey')
      .unique(['slug'], 'tag_slug_key'),
  )
  .table('post_tag', (t) =>
    t
      .column('post_id', { type: uuidColumn, nullable: false })
      .column('tag_id', { type: uuidColumn, nullable: false })
      .column('assigned_at', {
        type: timestamptzColumn,
        nullable: false,
        default: { kind: 'function', expression: 'now()' },
      })
      .primaryKey(['post_id', 'tag_id'], 'post_tag_pkey')
      .index(['tag_id'], 'post_tag_tag_id_idx')
      .foreignKey(
        ['post_id'],
        { table: 'post', columns: ['id'] },
        {
          name: 'post_tag_post_id_fkey',
          onDelete: 'cascade',
        },
      )
      .foreignKey(
        ['tag_id'],
        { table: 'tag', columns: ['id'] },
        {
          name: 'post_tag_tag_id_fkey',
          onDelete: 'cascade',
        },
      ),
  )
  .model('User', 'user', (m) =>
    m
      .field('id', 'id')
      .field('email', 'email')
      .field('createdAt', 'created_at')
      .field('kind', 'kind')
      .relation('profile', {
        toModel: 'Profile',
        toTable: 'profile',
        cardinality: '1:1',
        on: {
          parentTable: 'user',
          parentColumns: ['id'],
          childTable: 'profile',
          childColumns: ['user_id'],
        },
      })
      .relation('posts', {
        toModel: 'Post',
        toTable: 'post',
        cardinality: '1:N',
        on: {
          parentTable: 'user',
          parentColumns: ['id'],
          childTable: 'post',
          childColumns: ['author_id'],
        },
      }),
  )
  .model('Profile', 'profile', (m) =>
    m
      .field('id', 'id')
      .field('userId', 'user_id')
      .field('bio', 'bio')
      .field('embedding', 'embedding')
      .field('createdAt', 'created_at')
      .relation('user', {
        toModel: 'User',
        toTable: 'user',
        cardinality: 'N:1',
        on: {
          parentTable: 'profile',
          parentColumns: ['user_id'],
          childTable: 'user',
          childColumns: ['id'],
        },
      }),
  )
  .model('Post', 'post', (m) =>
    m
      .field('id', 'id')
      .field('authorId', 'author_id')
      .field('title', 'title')
      .field('status', 'status')
      .field('searchEmbedding', 'search_embedding')
      .field('createdAt', 'created_at')
      .relation('author', {
        toModel: 'User',
        toTable: 'user',
        cardinality: 'N:1',
        on: {
          parentTable: 'post',
          parentColumns: ['author_id'],
          childTable: 'user',
          childColumns: ['id'],
        },
      })
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
      .field('slug', 'slug')
      .field('label', 'label')
      .field('createdAt', 'created_at')
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
  .model('PostTag', 'post_tag', (m) =>
    m.field('postId', 'post_id').field('tagId', 'tag_id').field('assignedAt', 'assigned_at'),
  )
  .build();
