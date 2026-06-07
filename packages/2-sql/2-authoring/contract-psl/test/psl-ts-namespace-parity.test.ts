import { parsePslDocument } from '@prisma-next/psl-parser';
import type { ForeignKey, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  defineContract,
  extensionModel,
  field,
  model,
  rel,
} from '@prisma-next/sql-contract-ts/contract-builder';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

const supabaseExtensionPackRef = {
  kind: 'extension' as const,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  id: 'supabase' as const,
  version: '0.0.1',
};

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

  it('PSL colon-prefix produces the same spaceId/namespaceId/columns as the TS builder for a cross-contract-space FK', () => {
    // PSL: supabase:auth.User cross-space reference
    const pslDocument = parsePslDocument({
      schema: `model Profile {
  id    Int @id
  userId Int
  user  supabase:auth.User @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const pslResult = interpretPslDocumentToSqlContract({
      document: pslDocument,
      target: postgresTarget,
      scalarTypeDescriptors: postgresScalarTypeDescriptors,
      controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      composedExtensionPacks: ['supabase'],
    });

    expect(pslResult.ok).toBe(true);
    if (!pslResult.ok) return;

    // TS builder: AuthUser handle branded with spaceId:'supabase', namespace:'auth', table:'users'
    const AuthUser = extensionModel(
      'AuthUser',
      {
        namespace: 'auth',
        fields: { id: field.column({ codecId: 'pg/text@1', nativeType: 'text' }).id() },
        table: 'users',
      },
      'supabase' as const,
    );

    const Profile = model('Profile', {
      fields: {
        id: field.column({ codecId: 'pg/int4@1', nativeType: 'int4' }).id(),
        userId: field.column({ codecId: 'pg/int4@1', nativeType: 'int4' }),
      },
      relations: { user: rel.belongsTo(AuthUser, { from: 'userId', to: 'id' }) },
    }).sql(({ cols, constraints }) => ({
      table: 'profile',
      foreignKeys: [constraints.foreignKey(cols.userId, AuthUser.refs.id)],
    }));

    const tsContract = defineContract({
      family: { kind: 'family', id: 'sql', familyId: 'sql', version: '0.0.1' },
      target: postgresTarget,
      extensionPacks: { supabase: supabaseExtensionPackRef },
      models: { Profile },
    });

    const pslStorage = pslResult.value.storage as SqlStorage;
    const tsStorage = tsContract.storage as unknown as SqlStorage;

    // PSL: postgres target with no explicit namespace block routes top-level models to 'public'
    const pslProfileTable = pslStorage.namespaces['public']?.entries.table?.['profile'];
    const pslFks: readonly ForeignKey[] = pslProfileTable?.foreignKeys ?? [];

    // TS: postgres target, Profile model has no explicit namespace so it routes to 'public'
    const tsProfileTable = tsStorage.namespaces['public']?.entries.table?.['profile'];
    const tsFks: readonly ForeignKey[] = tsProfileTable?.foreignKeys ?? [];

    expect(pslFks.length).toBe(1);
    expect(tsFks.length).toBe(1);

    // spaceId, namespaceId, and columns must agree between PSL and TS paths
    expect(pslFks[0]).toMatchObject({
      target: {
        spaceId: 'supabase',
        namespaceId: 'auth',
        columns: ['id'],
      },
    });
    expect(tsFks[0]).toMatchObject({
      target: {
        spaceId: 'supabase',
        namespaceId: 'auth',
        columns: ['id'],
      },
    });

    // tableName differs: PSL uses 'User'.toLowerCase() = 'user' (symbolic fallback until M3
    // resolves it against the extension contract); TS carries the real table 'users' from the
    // branded handle. This is the documented resolution fork — see M2.4 brief "Known architecture
    // constraint". M3 will fix the PSL path by resolving the model name against the extension
    // contract at the aggregate stage.
    expect(pslFks[0]?.target.tableName).toBe('user');
    expect(tsFks[0]?.target.tableName).toBe('users');
  });
});
