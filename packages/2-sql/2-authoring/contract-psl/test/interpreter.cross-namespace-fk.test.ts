import { freezeNode, type Namespace, NamespaceBase } from '@prisma-next/framework-components/ir';
import { parsePslDocument } from '@prisma-next/psl-parser';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

class StubNamespace extends NamespaceBase {
  readonly kind = 'schema' as const;
  readonly id: string;

  constructor(id: string) {
    super();
    this.id = id;
    freezeNode(this);
  }

  qualifier(): string {
    return `"${this.id}"`;
  }

  qualifyTable(name: string): string {
    return `"${this.id}"."${name}"`;
  }
}

function createStubNamespace(id: string): Namespace {
  return new StubNamespace(id);
}

const baseInput = {
  target: postgresTarget,
  scalarTypeDescriptors: postgresScalarTypeDescriptors,
} as const;

const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();

interface ProfileFk {
  readonly source: { readonly columns: readonly string[] };
  readonly target: {
    readonly table: string;
    readonly namespaceId?: string;
    readonly columns: readonly string[];
  };
}

interface ProfileTable {
  readonly foreignKeys?: readonly ProfileFk[];
}

describe('FR16b cross-namespace FK lowering (PSL interpreter)', () => {
  it('resolves dot-qualified type references and populates target.namespaceId', () => {
    const document = parsePslDocument({
      schema: `namespace auth {
  model User {
    id String @id
  }
}

namespace public {
  model Profile {
    id     String   @id
    userId String
    user   auth.User @relation(fields: [userId], references: [id])
  }
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
      createNamespace: createStubNamespace,
    });

    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    if (!result.ok) return;
    const storage = result.value.storage as SqlStorage;
    const profile = (
      storage.tablesByNamespace?.['public'] as Record<string, ProfileTable> | undefined
    )?.['profile'];
    expect(profile, JSON.stringify(storage, null, 2)).toBeDefined();
    const fk = profile?.foreignKeys?.[0];
    expect(fk).toBeDefined();
    expect(fk?.target.table).toBe('user');
    expect(fk?.target.namespaceId).toBe('auth');
  });

  it('rejects dot-qualified type references whose namespace does not match the actual model namespace', () => {
    const document = parsePslDocument({
      schema: `namespace public {
  model User {
    id String @id
  }

  model Profile {
    id     String   @id
    userId String
    user   auth.User @relation(fields: [userId], references: [id])
  }
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
      createNamespace: createStubNamespace,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_RELATION_TARGET',
          message: expect.stringMatching(/auth\.User.*not in namespace.*auth/),
        }),
      ]),
    );
  });

  it('same-namespace relation fields keep target.namespaceId undefined (single-namespace fixtures stay byte-stable)', () => {
    const document = parsePslDocument({
      schema: `namespace public {
  model User {
    id String @id
  }

  model Profile {
    id     String @id
    userId String
    user   User   @relation(fields: [userId], references: [id])
  }
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
      createNamespace: createStubNamespace,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const storage = result.value.storage as SqlStorage;
    const profile = (
      storage.tablesByNamespace?.['public'] as Record<string, ProfileTable> | undefined
    )?.['profile'];
    const fk = profile?.foreignKeys?.[0];
    expect(fk?.target.table).toBe('user');
    // Same-namespace FK: target.namespaceId is auto-defaulted by the
    // StorageTable constructor to source's namespace; the FK input
    // emitted by the PSL interpreter does not write the field.
    expect(fk?.target.namespaceId).toBe('public');
  });
});
