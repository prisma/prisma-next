import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@prisma-next/framework-components/components';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/contract-builder';

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'sql'>;

const documentFamilyPack = {
  kind: 'family',
  id: 'document',
  familyId: 'document',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'document'>;

const postgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
} as const satisfies TargetPackRef<'sql', 'postgres'>;

const pgvectorExtensionPack = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
} as const satisfies ExtensionPackRef<'sql', 'postgres'>;

const mysqlExtensionPack = {
  ...pgvectorExtensionPack,
  targetId: 'mysql',
} as const satisfies ExtensionPackRef<'sql', 'mysql'>;

function unsafeExtensionPackRefForRuntimeTest<FamilyId extends string, TargetId extends string>(
  pack: FamilyPackRef<string> | TargetPackRef<string, string> | ExtensionPackRef<string, string>,
): ExtensionPackRef<FamilyId, TargetId> {
  // These runtime-guard tests intentionally bypass the static pack-ref contract so they can
  // assert the error paths for invalid inputs that well-typed authoring code cannot produce.
  return pack as unknown as ExtensionPackRef<FamilyId, TargetId>;
}

describe('defineContract runtime guards', () => {
  it.each([
    {
      name: 'non-SQL family packs',
      run: () =>
        defineContract({
          family: documentFamilyPack,
          target: postgresTargetPack,
          models: {},
        }),
      error: 'defineContract only accepts SQL family packs. Received family "document".',
    },
    {
      name: 'non-extension pack refs in extensionPacks',
      run: () =>
        defineContract({
          family: sqlFamilyPack,
          target: postgresTargetPack,
          extensionPacks: {
            invalid: unsafeExtensionPackRefForRuntimeTest(postgresTargetPack),
          },
          models: {},
        }),
      error:
        'defineContract only accepts extension pack refs in extensionPacks. Received kind "target".',
    },
    {
      name: 'extension packs from another family',
      run: () =>
        defineContract({
          family: sqlFamilyPack,
          target: postgresTargetPack,
          extensionPacks: {
            invalid: unsafeExtensionPackRefForRuntimeTest({
              ...pgvectorExtensionPack,
              familyId: 'document',
            }),
          },
          models: {},
        }),
      error:
        'extension pack "pgvector" targets family "document" but contract target family is "sql".',
    },
    {
      name: 'extension packs for another target',
      run: () =>
        defineContract({
          family: sqlFamilyPack,
          target: postgresTargetPack,
          extensionPacks: {
            invalid: mysqlExtensionPack,
          },
          models: {},
        }),
      error: 'extension pack "pgvector" targets "mysql" but contract target is "postgres".',
    },
  ])('rejects $name', ({ run, error }) => {
    expect(run).toThrow(error);
  });
});
