import { getStorageNamespace } from '@prisma-next/framework-components/ir';
import { parsePslDocument } from '@prisma-next/psl-parser';
import type { ForeignKey, SqlNamespace, SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

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
    const postTable = (
      getStorageNamespace(storage as unknown as Record<string, unknown>, 'public') as
        | SqlNamespace
        | undefined
    )?.tables['post'];
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
    const postTable = (
      getStorageNamespace(storage as unknown as Record<string, unknown>, 'public') as
        | SqlNamespace
        | undefined
    )?.tables['post'];
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
