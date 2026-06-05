import { parsePslDocument } from '@prisma-next/psl-parser';
import type { ForeignKey, SqlStorage } from '@prisma-next/sql-contract/types';
import { defineContract, field, model, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

const int4Column = { codecId: 'pg/int4@1', nativeType: 'int4' } as const;

describe('PSL ↔ TS namespace parity', () => {
  it('produces structurally equivalent Contract IR from PSL and TS builder for a 2-namespace schema with a cross-namespace FK', () => {
    // PSL authoring
    const pslDocument = parsePslDocument({
      schema: `namespace auth {
  model User {
    id Int @id
    posts public.Post[]
  }
}

namespace public {
  model Post {
    id    Int @id
    userId Int
    user  auth.User @relation(fields: [userId], references: [id])
  }
}
`,
      sourceId: 'schema.prisma',
    });

    const pslResult = interpretPslDocumentToSqlContract({
      document: pslDocument,
      target: postgresTarget,
      scalarTypeDescriptors: postgresScalarTypeDescriptors,
      controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
    });

    expect(pslResult.ok).toBe(true);
    if (!pslResult.ok) return;

    // TS builder authoring
    const UserBase = model('User', {
      namespace: 'auth',
      fields: {
        id: field.column(int4Column).id(),
      },
    }).sql({ table: 'user' });

    const Post = model('Post', {
      namespace: 'public',
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(int4Column),
      },
      relations: { user: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }) },
    }).sql(({ cols, constraints }) => ({
      table: 'post',
      foreignKeys: [constraints.foreignKey(cols.userId, UserBase.refs.id)],
    }));

    const User = UserBase.relations({
      posts: rel.hasMany(() => Post, { by: 'userId' }),
    });

    const tsContract = defineContract({
      family: { kind: 'family', id: 'sql', familyId: 'sql', version: '0.0.1' },
      target: postgresTarget,
      namespaces: ['auth', 'public'] as const,
      models: { User, Post },
    });

    const pslStorage = pslResult.value.storage as SqlStorage;
    const tsStorage = tsContract.storage as unknown as SqlStorage;

    // Same namespace keys
    expect(Object.keys(pslStorage.namespaces).sort()).toEqual(
      Object.keys(tsStorage.namespaces).sort(),
    );

    // Same per-namespace table keys
    for (const nsId of Object.keys(pslStorage.namespaces)) {
      const pslTables = pslStorage.namespaces[nsId]?.entries.table ?? {};
      const tsTables = tsStorage.namespaces[nsId]?.entries.table ?? {};
      expect(Object.keys(pslTables).sort()).toEqual(Object.keys(tsTables).sort());
    }

    // Same per-table column shapes
    const pslAuthUser = pslStorage.namespaces['auth']?.entries.table['user'];
    const tsAuthUser = tsStorage.namespaces['auth']?.entries.table['user'];
    expect(pslAuthUser?.columns).toEqual(tsAuthUser?.columns);

    const pslPublicPost = pslStorage.namespaces['public']?.entries.table['post'];
    const tsPublicPost = tsStorage.namespaces['public']?.entries.table['post'];
    expect(pslPublicPost?.columns).toEqual(tsPublicPost?.columns);

    // Same FK source/target
    const pslFks: readonly ForeignKey[] = pslPublicPost?.foreignKeys ?? [];
    const tsFks: readonly ForeignKey[] = tsPublicPost?.foreignKeys ?? [];
    expect(pslFks.length).toBe(1);
    expect(tsFks.length).toBe(1);
    expect(pslFks[0]).toMatchObject({
      source: { namespaceId: 'public', tableName: 'post' },
      target: { namespaceId: 'auth', tableName: 'user' },
    });
    expect(tsFks).toEqual(pslFks);
  });
});
