import type { TargetPackRef } from '@prisma-next/contract/framework-components';
import { describe, expect, it } from 'vitest';
import {
  defineContract,
  field,
  model,
  rel,
  type StagedModelBuilder,
} from '../src/contract-builder';

// biome-ignore lint/suspicious/noExplicitAny: widening for test convenience
type AnyModel = StagedModelBuilder<any, any, any, any, any>;

import { columnDescriptor } from './helpers/column-descriptor';

type PortableSqlCodecTypes = {
  readonly 'sql/char@1': { output: string };
  readonly 'sql/text@1': { output: string };
  readonly 'sql/timestamp@1': { output: string };
};

type PortableTargetPack<TTarget extends string> = TargetPackRef<'sql', TTarget> & {
  readonly __codecTypes?: PortableSqlCodecTypes;
};

const postgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
} as const satisfies PortableTargetPack<'postgres'>;

const sqliteTargetPack = {
  kind: 'target',
  id: 'sqlite',
  familyId: 'sql',
  targetId: 'sqlite',
  version: '0.0.1',
} as const satisfies PortableTargetPack<'sqlite'>;

const uuidColumn = columnDescriptor('sql/char@1', 'character', { length: 36 });
const textColumn = columnDescriptor('sql/text@1');
const timestampColumn = columnDescriptor('sql/timestamp@1');

function buildPortableContract<TTarget extends string>(target: PortableTargetPack<TTarget>) {
  const User: AnyModel = model('User', {
    fields: {
      id: field.column(uuidColumn).id({ name: 'app_user_pkey' }),
      email: field.column(textColumn).unique({ name: 'app_user_email_key' }),
      createdAt: field.column(timestampColumn).defaultSql('CURRENT_TIMESTAMP'),
    },
    relations: {
      posts: rel.hasMany(() => Post, { by: 'authorId' }),
    },
  }).sql({
    table: 'app_user',
  });

  const Post = model('Post', {
    fields: {
      id: field.column(uuidColumn).id({ name: 'blog_post_pkey' }),
      authorId: field.column(uuidColumn),
      title: field.column(textColumn),
    },
    relations: {
      author: rel.belongsTo(User, { from: 'authorId', to: 'id' }),
    },
  }).sql(({ cols, constraints }) => ({
    table: 'blog_post',
    foreignKeys: [
      constraints.foreignKey([cols.authorId], [User.refs['id']!], {
        name: 'blog_post_author_id_fkey',
        onDelete: 'cascade',
      }),
    ],
  }));

  return defineContract({
    target,
    naming: { tables: 'snake_case', columns: 'snake_case' },
    storageHash: 'sha256:portable-staged-contract-dsl',
    models: {
      User,
      Post,
    },
  });
}

describe('staged contract DSL portability coverage', () => {
  it('keeps portable staged contracts identical across postgres and sqlite target swaps', () => {
    const postgresContract = buildPortableContract(postgresTargetPack);
    const sqliteContract = buildPortableContract(sqliteTargetPack);
    const postgresStorageTables = postgresContract.storage.tables as Record<
      string,
      { readonly columns: Record<string, unknown> }
    >;

    expect(postgresContract.target).toBe('postgres');
    expect(sqliteContract.target).toBe('sqlite');
    expect(postgresStorageTables['app_user']?.columns['created_at']).toMatchObject({
      codecId: 'sql/timestamp@1',
      nativeType: 'timestamp',
      default: {
        kind: 'function',
        expression: 'CURRENT_TIMESTAMP',
      },
    });
    expect(postgresStorageTables['blog_post']?.columns['author_id']).toMatchObject({
      codecId: 'sql/char@1',
      nativeType: 'character',
      typeParams: { length: 36 },
    });

    const { target: _postgresTarget, ...postgresPortableShape } = postgresContract;
    const { target: _sqliteTarget, ...sqlitePortableShape } = sqliteContract;

    expect(sqlitePortableShape).toEqual(postgresPortableShape);
  });
});
