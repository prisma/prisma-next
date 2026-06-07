import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import { parsePslDocument } from '@prisma-next/psl-parser';
import type { ForeignKey, SqlStorage } from '@prisma-next/sql-contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

function makeSupabaseExtensionContract(): Contract {
  return blindCast<
    Contract,
    'synthetic supabase extension contract for interpreter FK resolution tests'
  >({
    target: 'postgres',
    targetFamily: 'sql',
    roots: {},
    domain: {
      namespaces: {
        auth: {
          models: {
            User: { fields: {}, relations: {}, storage: { table: 'users' } },
          },
        },
      },
    },
    storage: {
      storageHash: coreHash('sha256:' + 'a'.repeat(64)),
      namespaces: {
        auth: {
          id: 'auth',
          entries: {
            table: {
              users: {
                columns: { id: { type: 'int4', nullable: false } },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        },
      },
    },
    capabilities: {},
    extensionPacks: {},
    profileHash: profileHash('sha256:' + 'b'.repeat(64)),
    meta: {},
  });
}

const baseInput = {
  target: postgresTarget,
  scalarTypeDescriptors: postgresScalarTypeDescriptors,
  controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
} as const;

describe('interpretPslDocumentToSqlContract cross-namespace FK resolution', () => {
  it('lowers a qualified relation field type to a FK with target.namespaceId from the qualifier', () => {
    const document = parsePslDocument({
      schema: `namespace public {
  model Post {
    id Int @id
    userId Int
    user auth.User @relation(fields: [userId], references: [id])
  }
}

namespace auth {
  model User {
    id Int @id
    @@map("user")
  }
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = result.value.storage as SqlStorage;
    const postTable = storage.namespaces['public']?.entries.table?.['post'];
    expect(postTable).toBeDefined();

    const fks: readonly ForeignKey[] = postTable?.foreignKeys ?? [];
    expect(fks.length).toBe(1);
    expect(fks[0]).toMatchObject({
      target: { namespaceId: 'auth', tableName: 'user' },
    });
  });

  it('lowers an unqualified relation to a model that lives in another namespace', () => {
    const document = parsePslDocument({
      schema: `namespace public {
  model Post {
    id Int @id
    userId Int
    user User @relation(fields: [userId], references: [id])
  }
}

namespace auth {
  model User {
    id Int @id
    @@map("user")
  }
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = result.value.storage as SqlStorage;
    const postTable = storage.namespaces['public']?.entries.table?.['post'];
    const fks: readonly ForeignKey[] = postTable?.foreignKeys ?? [];
    expect(fks.length).toBe(1);
    expect(fks[0]).toMatchObject({
      target: { namespaceId: 'auth', tableName: 'user' },
    });
  });

  it('emits PSL_INVALID_RELATION_TARGET when qualifier names a non-existent namespace', () => {
    const document = parsePslDocument({
      schema: `namespace public {
  model Post {
    id Int @id
    userId Int
    user wrong.User @relation(fields: [userId], references: [id])
  }
}

namespace auth {
  model User {
    id Int @id
  }
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_RELATION_TARGET',
          message: expect.stringContaining('wrong.User'),
        }),
      ]),
    );
  });
});

describe('interpretPslDocumentToSqlContract cross-contract-space FK (PSL colon-prefix)', () => {
  it('lowers supabase:auth.User to a FK with spaceId=supabase and namespaceId=auth', () => {
    const document = parsePslDocument({
      schema: `model Profile {
  id Int @id
  userId Int
  user supabase:auth.User @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      composedExtensionPacks: ['supabase'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = result.value.storage as SqlStorage;
    // Unbound namespace (no explicit namespace block)
    const profileTable = Object.values(storage.namespaces)
      .flatMap((ns) => Object.values(ns.entries.table ?? {}))
      .find((t) => t !== undefined);
    expect(profileTable).toBeDefined();

    const fks: readonly ForeignKey[] = profileTable?.foreignKeys ?? [];
    expect(fks.length).toBe(1);
    expect(fks[0]).toMatchObject({
      target: {
        spaceId: 'supabase',
        namespaceId: 'auth',
        columns: ['id'],
      },
    });
  });

  it('lowers supabase:User (no-namespace form) with namespaceId=__unbound__ (AC3)', () => {
    const document = parsePslDocument({
      schema: `model Profile {
  id Int @id
  userId Int
  user supabase:User @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      composedExtensionPacks: ['supabase'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = result.value.storage as SqlStorage;
    const profileTable = Object.values(storage.namespaces)
      .flatMap((ns) => Object.values(ns.entries.table ?? {}))
      .find((t) => t !== undefined);
    const fks: readonly ForeignKey[] = profileTable?.foreignKeys ?? [];
    expect(fks.length).toBe(1);
    expect(fks[0]).toMatchObject({
      target: {
        spaceId: 'supabase',
        namespaceId: '__unbound__',
        columns: ['id'],
      },
    });
  });

  it('emits PSL_UNKNOWN_CONTRACT_SPACE when the space is not in composedExtensionPacks (AC5)', () => {
    const document = parsePslDocument({
      schema: `model Profile {
  id Int @id
  userId Int
  user supabase:auth.User @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    // supabase is NOT in composedExtensionPacks
    const result = interpretPslDocumentToSqlContract({ ...baseInput, document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNKNOWN_CONTRACT_SPACE',
          message: expect.stringContaining('supabase'),
        }),
      ]),
    );
  });

  it('F-list: cross-space list relation emits PSL_UNSUPPORTED_CROSS_SPACE_LIST diagnostic instead of silently dropping it', () => {
    const document = parsePslDocument({
      schema: `model Profile {
  id Int @id
  userId Int
  posts supabase:auth.Post[] @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      composedExtensionPacks: ['supabase'],
    });

    // The result should fail with a diagnostic (not silently succeed with 0 FKs)
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_CROSS_SPACE_LIST',
          message: expect.stringContaining('posts'),
        }),
      ]),
    );
  });

  it('cross-space FK with onDelete:cascade emits no diagnostic (AC4)', () => {
    const document = parsePslDocument({
      schema: `model Profile {
  id Int @id
  userId Int
  user supabase:auth.User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      composedExtensionPacks: ['supabase'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = result.value.storage as SqlStorage;
    const profileTable = Object.values(storage.namespaces)
      .flatMap((ns) => Object.values(ns.entries.table ?? {}))
      .find((t) => t !== undefined);
    const fks: readonly ForeignKey[] = profileTable?.foreignKeys ?? [];
    expect(fks.length).toBe(1);
    expect(fks[0]).toMatchObject({
      target: { spaceId: 'supabase' },
      onDelete: 'cascade',
    });
  });

  it('resolves FK target.tableName from the extension contract when composedExtensionContracts is provided', () => {
    const document = parsePslDocument({
      schema: `model Profile {
  id Int @id
  userId Int
  user supabase:auth.User @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      composedExtensionPacks: ['supabase'],
      composedExtensionContracts: new Map([['supabase', makeSupabaseExtensionContract()]]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = result.value.storage as SqlStorage;
    const profileTable = Object.values(storage.namespaces)
      .flatMap((ns) => Object.values(ns.entries.table ?? {}))
      .find((t) => t !== undefined);
    const fks: readonly ForeignKey[] = profileTable?.foreignKeys ?? [];
    expect(fks.length).toBe(1);
    expect(fks[0]).toMatchObject({
      target: {
        spaceId: 'supabase',
        namespaceId: 'auth',
        tableName: 'users',
        columns: ['id'],
      },
    });
  });

  it('emits PSL_UNKNOWN_CROSS_SPACE_TARGET when the extension contract is provided but the model is not found', () => {
    const document = parsePslDocument({
      schema: `model Profile {
  id Int @id
  userId Int
  user supabase:auth.NonExistentModel @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      composedExtensionPacks: ['supabase'],
      composedExtensionContracts: new Map([['supabase', makeSupabaseExtensionContract()]]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNKNOWN_CROSS_SPACE_TARGET',
          message: expect.stringContaining('NonExistentModel'),
        }),
      ]),
    );
  });
});
